import type { DayOfWeek, Prisma, ShiftPattern, StaffingRole } from "@prisma/client";
import { db } from "@/lib/db";
import { hospitalDate } from "@/lib/timezone";
import {
  STAFFING_AUDIT_TARGET_TYPE,
  describeStaffingAudit,
  formatDayKey,
  isStaffingAuditAction,
  templateRef,
  type StaffingAuditEntry,
  type TemplateTimes,
} from "./audit";
import { STAFFING_ROLES, STAFFING_ROLE_LABEL } from "./roles";
import { buildTargetBook, dayOfWeekOfKey, weeklyTarget } from "./targets";
import { activeTemplates, templateDisplayName } from "./templates";

/**
 * DB access for the staffing targets page. Every write runs in one
 * transaction that first locks the department row, so two admins saving at
 * once are serialized; each write also checks the value the admin was looking
 * at (`before`/`expected`) and refuses with STALE if someone changed it in
 * the meantime, rather than silently overwriting. Every change writes an
 * `AuditLog` row (who + when) in the same transaction.
 *
 * Results are typed, never thrown (CLAUDE.md "Server-action validation").
 */

export type StaffingFailureReason = "NOT_FOUND" | "STALE" | "PAST_DATE" | "NO_CHANGE" | "INVALID";

export type StaffingResult = { ok: true; message: string } | { ok: false; reason: StaffingFailureReason; message: string };

const STALE_MESSAGE = "Someone else changed these numbers while you were editing. The page now shows the latest values.";

function fail(reason: StaffingFailureReason, message: string): StaffingResult {
  return { ok: false, reason, message };
}

type Tx = Prisma.TransactionClient;

/** Serialize all staffing writes for one department. False = no such department. */
async function lockDepartment(tx: Tx, departmentId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Department" WHERE "id" = ${departmentId} FOR UPDATE`;
  return rows.length === 1;
}

async function audit(
  tx: Tx,
  actorId: string,
  department: { id: string; hospitalId: string | null },
  entry: StaffingAuditEntry
) {
  await tx.auditLog.create({
    data: {
      actorId,
      hospitalId: department.hospitalId,
      action: entry.action,
      targetType: STAFFING_AUDIT_TARGET_TYPE,
      targetId: department.id,
      metadata: entry.metadata as unknown as Prisma.InputJsonValue,
    },
  });
}

/** Today's hospital day key; overrides are only ever set or removed for today or later. */
export function todayKey(now = new Date()): string {
  return hospitalDate(now);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface TemplateView {
  id: string;
  pattern: ShiftPattern;
  code: string;
  label: string;
  startMinute: number;
  endMinute: number;
  leadRequired: boolean;
  sortOrder: number;
}

export interface OverrideView {
  id: string;
  templateId: string;
  date: string;
  role: StaffingRole;
  count: number;
  reason: string | null;
  setByName: string | null;
  updatedAt: string;
}

export interface HistoryEntry {
  id: string;
  at: string;
  actorName: string;
  line: string;
}

export interface StaffingTargetsView {
  department: {
    id: string;
    name: string;
    code: string;
    iconKey: string;
    unitLabel: string | null;
    location: string | null;
    shiftPattern: ShiftPattern;
  };
  templates: TemplateView[];
  weekly: { templateId: string; dayOfWeek: DayOfWeek; role: StaffingRole; count: number }[];
  overrides: OverrideView[];
  history: HistoryEntry[];
  today: string;
}

export const HISTORY_LIMIT = 25;

/** Everything the targets page renders, or null for an unknown department. */
export async function loadStaffingTargets(departmentId: string, now = new Date()): Promise<StaffingTargetsView | null> {
  const department = await db.department.findUnique({
    where: { id: departmentId },
    select: { id: true, name: true, code: true, iconKey: true, unitLabel: true, location: true, shiftPattern: true },
  });
  if (!department) return null;

  const today = todayKey(now);
  const [templates, weekly, overrides, auditRows] = await Promise.all([
    db.shiftTemplate.findMany({
      where: { departmentId },
      orderBy: [{ pattern: "asc" }, { sortOrder: "asc" }],
      select: {
        id: true,
        pattern: true,
        code: true,
        label: true,
        startMinute: true,
        endMinute: true,
        leadRequired: true,
        sortOrder: true,
      },
    }),
    db.staffingTarget.findMany({
      where: { template: { departmentId } },
      select: { templateId: true, dayOfWeek: true, role: true, count: true },
    }),
    db.staffingTargetOverride.findMany({
      where: { template: { departmentId }, date: { gte: today } },
      orderBy: [{ date: "asc" }],
      select: {
        id: true,
        templateId: true,
        date: true,
        role: true,
        count: true,
        reason: true,
        updatedAt: true,
        setBy: { select: { name: true } },
      },
    }),
    db.auditLog.findMany({
      where: { targetType: STAFFING_AUDIT_TARGET_TYPE, targetId: departmentId },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      select: { id: true, action: true, actorId: true, metadata: true, createdAt: true },
    }),
  ]);

  const actors = await db.user.findMany({
    where: { id: { in: Array.from(new Set(auditRows.map((r) => r.actorId))) } },
    select: { id: true, name: true },
  });
  const actorName = new Map(actors.map((a) => [a.id, a.name]));

  return {
    department,
    templates,
    weekly,
    overrides: overrides.map((o) => ({
      id: o.id,
      templateId: o.templateId,
      date: o.date,
      role: o.role,
      count: o.count,
      reason: o.reason,
      setByName: o.setBy?.name ?? null,
      updatedAt: o.updatedAt.toISOString(),
    })),
    history: auditRows.flatMap((r) =>
      isStaffingAuditAction(r.action)
        ? [
            {
              id: r.id,
              at: r.createdAt.toISOString(),
              actorName: actorName.get(r.actorId) ?? "A removed user",
              line: describeStaffingAudit({ action: r.action, metadata: r.metadata } as unknown as StaffingAuditEntry),
            },
          ]
        : []
    ),
    today,
  };
}

// ---------------------------------------------------------------------------
// Weekly targets
// ---------------------------------------------------------------------------

export interface WeeklyTargetChange {
  templateId: string;
  role: StaffingRole;
  days: DayOfWeek[];
  /** What the admin saw for each day, aligned with `days`. */
  before: number[];
  count: number;
}

export async function saveWeeklyTargets(
  actorId: string,
  input: { departmentId: string; changes: WeeklyTargetChange[] }
): Promise<StaffingResult> {
  return db.$transaction(async (tx) => {
    if (!(await lockDepartment(tx, input.departmentId))) return fail("NOT_FOUND", "That department no longer exists.");
    const department = await tx.department.findUniqueOrThrow({
      where: { id: input.departmentId },
      select: { id: true, hospitalId: true },
    });

    const templateIds = Array.from(new Set(input.changes.map((c) => c.templateId)));
    const templates = await tx.shiftTemplate.findMany({
      where: { id: { in: templateIds }, departmentId: input.departmentId },
    });
    if (templates.length !== templateIds.length) return fail("NOT_FOUND", "One of those shifts no longer exists.");
    const templateById = new Map(templates.map((t) => [t.id, t]));

    const current = await tx.staffingTarget.findMany({ where: { templateId: { in: templateIds } } });
    const book = buildTargetBook(current, []);

    for (const change of input.changes) {
      const now = change.days.map((d) => weeklyTarget(book, change.templateId, d, change.role));
      if (now.some((v, i) => v !== change.before[i])) return fail("STALE", STALE_MESSAGE);
    }

    let changed = 0;
    for (const change of input.changes) {
      const before = change.days.map((d) => weeklyTarget(book, change.templateId, d, change.role));
      if (before.every((v) => v === change.count)) continue;
      for (const dayOfWeek of change.days) {
        await tx.staffingTarget.upsert({
          where: { templateId_dayOfWeek_role: { templateId: change.templateId, dayOfWeek, role: change.role } },
          create: { templateId: change.templateId, dayOfWeek, role: change.role, count: change.count, setById: actorId },
          update: { count: change.count, setById: actorId },
        });
      }
      await audit(tx, actorId, department, {
        action: "STAFFING_TARGET_CHANGED",
        metadata: {
          ...templateRef(templateById.get(change.templateId)!),
          role: change.role,
          days: change.days,
          before,
          after: change.count,
        },
      });
      changed++;
    }

    if (changed === 0) return fail("NO_CHANGE", "Nothing to save - those are already the numbers.");
    return { ok: true, message: changed === 1 ? "Saved 1 change." : `Saved ${changed} changes.` };
  });
}

// ---------------------------------------------------------------------------
// One-date overrides
// ---------------------------------------------------------------------------

type OverrideTemplate = { id: string; code: string; label: string; pattern: ShiftPattern };

/**
 * Make `count` the target for one (template, date, role). Setting it back to
 * the usual number removes the override, so an override always means "this
 * date differs". Returns whether anything changed.
 */
async function writeDateTarget(
  tx: Tx,
  actorId: string,
  department: { id: string; hospitalId: string | null },
  template: OverrideTemplate,
  cell: { date: string; role: StaffingRole; count: number; reason: string | null }
): Promise<"SET" | "REMOVED" | "UNCHANGED"> {
  const [weekly, existing] = await Promise.all([
    tx.staffingTarget.findUnique({
      where: {
        templateId_dayOfWeek_role: { templateId: template.id, dayOfWeek: dayOfWeekOfKey(cell.date), role: cell.role },
      },
    }),
    tx.staffingTargetOverride.findUnique({
      where: { templateId_date_role: { templateId: template.id, date: cell.date, role: cell.role } },
    }),
  ]);
  const usual = weekly?.count ?? 0;

  if (cell.count === usual) {
    if (!existing) return "UNCHANGED";
    await tx.staffingTargetOverride.delete({ where: { id: existing.id } });
    await audit(tx, actorId, department, {
      action: "STAFFING_OVERRIDE_REMOVED",
      metadata: { ...templateRef(template), role: cell.role, date: cell.date, before: existing.count, usual, reason: existing.reason },
    });
    return "REMOVED";
  }

  if (existing && existing.count === cell.count && existing.reason === cell.reason) return "UNCHANGED";
  await tx.staffingTargetOverride.upsert({
    where: { templateId_date_role: { templateId: template.id, date: cell.date, role: cell.role } },
    create: { templateId: template.id, date: cell.date, role: cell.role, count: cell.count, reason: cell.reason, setById: actorId },
    update: { count: cell.count, reason: cell.reason, setById: actorId },
  });
  await audit(tx, actorId, department, {
    action: "STAFFING_OVERRIDE_SET",
    metadata: {
      ...templateRef(template),
      role: cell.role,
      date: cell.date,
      before: existing?.count ?? null,
      after: cell.count,
      usual,
      reason: cell.reason,
    },
  });
  return "SET";
}

export interface SetOverrideInput {
  templateId: string;
  date: string;
  role: StaffingRole;
  count: number;
  reason: string | null;
  /** The override count the admin saw for that cell; null = none. */
  expected: number | null;
}

export async function setTargetOverride(actorId: string, input: SetOverrideInput, now = new Date()): Promise<StaffingResult> {
  if (input.date < todayKey(now)) return fail("PAST_DATE", "Pick today or a later date.");

  return db.$transaction(async (tx) => {
    const template = await tx.shiftTemplate.findUnique({ where: { id: input.templateId } });
    if (!template || !(await lockDepartment(tx, template.departmentId))) {
      return fail("NOT_FOUND", "That shift no longer exists.");
    }
    const department = await tx.department.findUniqueOrThrow({
      where: { id: template.departmentId },
      select: { id: true, hospitalId: true },
    });

    const existing = await tx.staffingTargetOverride.findUnique({
      where: { templateId_date_role: { templateId: template.id, date: input.date, role: input.role } },
    });
    if ((existing?.count ?? null) !== input.expected) return fail("STALE", STALE_MESSAGE);

    const outcome = await writeDateTarget(tx, actorId, department, template, input);
    const cell = `${templateDisplayName(template)} ${STAFFING_ROLE_LABEL[input.role]} on ${formatDayKey(input.date)}`;
    if (outcome === "UNCHANGED") {
      return fail("NO_CHANGE", `${input.count} is already the number for ${cell}.`);
    }
    return {
      ok: true,
      message: outcome === "REMOVED" ? `${cell} is back to the usual ${input.count}.` : `${cell} set to ${input.count}.`,
    };
  });
}

export async function removeTargetOverride(
  actorId: string,
  input: { overrideId: string },
  now = new Date()
): Promise<StaffingResult> {
  return db.$transaction(async (tx) => {
    const existing = await tx.staffingTargetOverride.findUnique({
      where: { id: input.overrideId },
      include: { template: true },
    });
    if (!existing || !(await lockDepartment(tx, existing.template.departmentId))) {
      return fail("STALE", "That override was already removed.");
    }
    if (existing.date < todayKey(now)) return fail("PAST_DATE", "Past dates can't be changed.");
    // Re-read under the lock: a concurrent removal may have won.
    const still = await tx.staffingTargetOverride.findUnique({ where: { id: existing.id } });
    if (!still) return fail("STALE", "That override was already removed.");

    const department = await tx.department.findUniqueOrThrow({
      where: { id: existing.template.departmentId },
      select: { id: true, hospitalId: true },
    });
    const weekly = await tx.staffingTarget.findUnique({
      where: {
        templateId_dayOfWeek_role: {
          templateId: existing.templateId,
          dayOfWeek: dayOfWeekOfKey(existing.date),
          role: existing.role,
        },
      },
    });
    const usual = weekly?.count ?? 0;
    await tx.staffingTargetOverride.delete({ where: { id: existing.id } });
    await audit(tx, actorId, department, {
      action: "STAFFING_OVERRIDE_REMOVED",
      metadata: {
        ...templateRef(existing.template),
        role: existing.role,
        date: existing.date,
        before: still.count,
        usual,
        reason: still.reason,
      },
    });
    return {
      ok: true,
      message: `${templateDisplayName(existing.template)} ${STAFFING_ROLE_LABEL[existing.role]} on ${formatDayKey(existing.date)} is back to the usual ${usual}.`,
    };
  });
}

/**
 * Holiday shortcut: make every shift and role on `date` use that department's
 * Sunday numbers (there is no Holiday model; this covers statutory holidays).
 */
export async function applySundayNumbers(
  actorId: string,
  input: { departmentId: string; date: string; reason: string | null },
  now = new Date()
): Promise<StaffingResult> {
  if (input.date < todayKey(now)) return fail("PAST_DATE", "Pick today or a later date.");

  return db.$transaction(async (tx) => {
    if (!(await lockDepartment(tx, input.departmentId))) return fail("NOT_FOUND", "That department no longer exists.");
    const department = await tx.department.findUniqueOrThrow({
      where: { id: input.departmentId },
      select: { id: true, hospitalId: true, shiftPattern: true },
    });
    const templates = activeTemplates(
      await tx.shiftTemplate.findMany({ where: { departmentId: department.id } }),
      department.shiftPattern
    );
    const weekly = await tx.staffingTarget.findMany({ where: { templateId: { in: templates.map((t) => t.id) } } });
    const book = buildTargetBook(weekly, []);

    let changed = 0;
    for (const template of templates) {
      for (const role of STAFFING_ROLES) {
        const outcome = await writeDateTarget(tx, actorId, department, template, {
          date: input.date,
          role,
          count: weeklyTarget(book, template.id, "SUN", role),
          reason: input.reason,
        });
        if (outcome !== "UNCHANGED") changed++;
      }
    }
    if (changed === 0) return fail("NO_CHANGE", `${formatDayKey(input.date)} already uses the Sunday numbers.`);
    return { ok: true, message: `${formatDayKey(input.date)} now uses the Sunday numbers.` };
  });
}

// ---------------------------------------------------------------------------
// Shift definitions
// ---------------------------------------------------------------------------

export async function updateShiftTemplate(
  actorId: string,
  input: { templateId: string; before: TemplateTimes; after: TemplateTimes }
): Promise<StaffingResult> {
  return db.$transaction(async (tx) => {
    const template = await tx.shiftTemplate.findUnique({ where: { id: input.templateId } });
    if (!template || !(await lockDepartment(tx, template.departmentId))) {
      return fail("NOT_FOUND", "That shift no longer exists.");
    }
    const fresh = await tx.shiftTemplate.findUniqueOrThrow({ where: { id: template.id } });
    const current: TemplateTimes = {
      startMinute: fresh.startMinute,
      endMinute: fresh.endMinute,
      leadRequired: fresh.leadRequired,
    };
    if (
      current.startMinute !== input.before.startMinute ||
      current.endMinute !== input.before.endMinute ||
      current.leadRequired !== input.before.leadRequired
    ) {
      return fail("STALE", "Someone else changed this shift while you were editing. The page now shows the latest times.");
    }
    if (
      current.startMinute === input.after.startMinute &&
      current.endMinute === input.after.endMinute &&
      current.leadRequired === input.after.leadRequired
    ) {
      return fail("NO_CHANGE", "Nothing to save.");
    }

    const department = await tx.department.findUniqueOrThrow({
      where: { id: template.departmentId },
      select: { id: true, hospitalId: true },
    });
    await tx.shiftTemplate.update({ where: { id: template.id }, data: input.after });
    await audit(tx, actorId, department, {
      action: "SHIFT_TEMPLATE_CHANGED",
      metadata: { ...templateRef(fresh), before: current, after: input.after },
    });
    return { ok: true, message: `${templateDisplayName(fresh)} shift saved.` };
  });
}

export async function setShiftPattern(
  actorId: string,
  input: { departmentId: string; from: ShiftPattern; to: ShiftPattern }
): Promise<StaffingResult> {
  return db.$transaction(async (tx) => {
    if (!(await lockDepartment(tx, input.departmentId))) return fail("NOT_FOUND", "That department no longer exists.");
    const department = await tx.department.findUniqueOrThrow({
      where: { id: input.departmentId },
      select: { id: true, hospitalId: true, shiftPattern: true },
    });
    if (department.shiftPattern !== input.from) {
      return fail("STALE", "Someone else changed this department's shift length. The page now shows the latest.");
    }
    if (input.from === input.to) return fail("NO_CHANGE", "Nothing to save.");

    await tx.department.update({ where: { id: department.id }, data: { shiftPattern: input.to } });
    await audit(tx, actorId, department, {
      action: "SHIFT_PATTERN_CHANGED",
      metadata: { before: input.from, after: input.to },
    });
    return {
      ok: true,
      message: input.to === "TWELVE_HOUR" ? "Switched to 12-hour shifts." : "Switched to 8-hour shifts.",
    };
  });
}

