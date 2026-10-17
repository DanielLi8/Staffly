"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AvailabilityStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { actorFromSession, requireAuth } from "@/lib/auth";
import { shiftListWhere } from "@/lib/authz";
import { addDaysToKey, dayKeysBetween, hospitalInstant } from "@/lib/timezone";
import { buildAvailabilityRows, MAX_AVAILABILITY_DAYS } from "@/lib/availability/build";
import { dayKeysLabel, rowDayKey } from "@/lib/availability/blocks";
import type { AvailabilityDTO } from "@/lib/availability/types";
import type { PersonalScheduleShift } from "@/features/schedule/shift-block";
import { notifyAdminsOfAvailabilityChange, notifyWorkerOfAvailabilityUpdate } from "@/lib/notifications";

const dayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const saveAvailabilitySchema = z.object({
  dates: z.array(dayKeySchema).min(1).max(MAX_AVAILABILITY_DAYS),
  blocks: z
    .array(
      z.object({
        status: z.enum(["AVAILABLE", "UNAVAILABLE"]),
        startMinute: z.number().int(),
        endMinute: z.number().int(),
      })
    )
    .min(1)
    .max(12),
});

const restoreAvailabilitySchema = z.object({
  dates: z.array(dayKeySchema).min(1).max(MAX_AVAILABILITY_DAYS),
  rows: z
    .array(
      z.object({
        startsAt: z.coerce.date(),
        endsAt: z.coerce.date(),
        status: z.enum(["AVAILABLE", "UNAVAILABLE", "TENTATIVE"]),
        departmentId: z.string().nullable(),
      })
    )
    .max(MAX_AVAILABILITY_DAYS * 12),
});

const contextSchema = z.object({ from: dayKeySchema, to: dayKeySchema });

/** What a save replaced, handed back so the client can offer Undo. */
export interface ReplacedAvailabilityRow {
  startsAt: Date;
  endsAt: Date;
  status: AvailabilityStatus;
  departmentId: string | null;
}

/**
 * Validation is returned, never thrown - a routine bad input (no days, an
 * impossible time) must not surface as Next.js's opaque server-action
 * "digest" message, same reasoning as `CreateShiftFailure` in
 * `src/app/actions/shifts.ts`.
 */
export type SaveAvailabilityResult =
  | { ok: true; count: number; dateLabel: string; previous: ReplacedAvailabilityRow[] }
  | { ok: false; error: string };

export type RestoreAvailabilityResult = { ok: true } | { ok: false; error: string };

const MAX_ROW_MS = 48 * 60 * 60 * 1000;

function daysWhere(userId: string, dayKeys: string[]): Prisma.AvailabilityWhereInput {
  return {
    userId,
    OR: dayKeys.map((key) => ({
      startsAt: { gte: hospitalInstant(key, 0), lt: hospitalInstant(addDaysToKey(key, 1), 0) },
    })),
  };
}

/**
 * Replaces everything saved on `dayKeys` (rows are owned by the hospital day
 * they START on, so a night block spilling in from the day before is left
 * alone) with `rows`, in one transaction, and returns what was there before.
 */
async function replaceDays(
  userId: string,
  dayKeys: string[],
  rows: { startsAt: Date; endsAt: Date; status: AvailabilityStatus; departmentId?: string | null }[]
): Promise<ReplacedAvailabilityRow[]> {
  const where = daysWhere(userId, dayKeys);
  return db.$transaction(async (tx) => {
    const previous = await tx.availability.findMany({
      where,
      select: { startsAt: true, endsAt: true, status: true, departmentId: true },
      orderBy: { startsAt: "asc" },
    });
    await tx.availability.deleteMany({ where });
    if (rows.length > 0) {
      await tx.availability.createMany({
        data: rows.map((row) => ({
          userId,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          status: row.status,
          departmentId: row.departmentId ?? null,
        })),
      });
    }
    return previous;
  });
}

async function notifyAvailabilityChanged(userId: string, userName: string, dateLabel: string) {
  await notifyWorkerOfAvailabilityUpdate({ workerId: userId, dateLabel });
  await notifyAdminsOfAvailabilityChange({ workerName: userName, dateLabel });
  revalidatePath("/worker/schedule");
}

/**
 * Sets the same blocks on every selected day, replacing whatever each of
 * those days had (the editor shows what is saved before you save, and warns
 * when the selected days differ - see `selectionPattern`). Saves instantly;
 * this is not a request.
 */
export async function saveAvailability(rawInput: unknown): Promise<SaveAvailabilityResult> {
  const session = await requireAuth("STAFF");

  const parsed = saveAvailabilitySchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "Select at least one day and a time range." };
  const { dates, blocks } = parsed.data;

  const built = buildAvailabilityRows(dates, blocks);
  if (!built.ok) return { ok: false, error: built.error };

  const dayKeys = Array.from(new Set(dates)).sort();
  const previous = await replaceDays(session.user.id, dayKeys, built.rows);

  const dateLabel = dayKeysLabel(dayKeys);
  await notifyAvailabilityChanged(session.user.id, session.user.name, dateLabel);
  return { ok: true, count: dayKeys.length, dateLabel, previous };
}

/**
 * Undo for `saveAvailability`: puts back exactly the rows a save replaced.
 * Re-validated like any other write - every row must belong to one of the
 * given days, and a department scope is kept only if the worker is still a
 * member there.
 */
export async function restoreAvailability(rawInput: unknown): Promise<RestoreAvailabilityResult> {
  const session = await requireAuth("STAFF");

  const parsed = restoreAvailabilitySchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "Couldn't undo that change." };
  const dayKeys = Array.from(new Set(parsed.data.dates)).sort();
  const allowedDays = new Set(dayKeys);

  for (const row of parsed.data.rows) {
    const span = row.endsAt.getTime() - row.startsAt.getTime();
    if (!allowedDays.has(rowDayKey(row)) || span <= 0 || span > MAX_ROW_MS) {
      return { ok: false, error: "Couldn't undo that change." };
    }
  }

  const memberships = await db.departmentMembership.findMany({
    where: { userId: session.user.id },
    select: { departmentId: true },
  });
  const memberOf = new Set(memberships.map((m) => m.departmentId));
  const rows = parsed.data.rows.map((row) => ({
    ...row,
    departmentId: row.departmentId && memberOf.has(row.departmentId) ? row.departmentId : null,
  }));

  await replaceDays(session.user.id, dayKeys, rows);
  await notifyAvailabilityChanged(session.user.id, session.user.name, dayKeysLabel(dayKeys));
  return { ok: true };
}

export type AvailabilityContextResult =
  | { ok: true; availability: AvailabilityDTO[]; shifts: PersonalScheduleShift[] }
  | { ok: false; error: string };

/**
 * The signed-in worker's own saved availability and assigned shifts for a
 * day range - what the editor needs to show "saved now" and conflicts for a
 * date range that reaches past the calendar page being viewed. Rows from the
 * day before are included so a night block spilling into `from` is known.
 */
export async function loadAvailabilityContext(rawInput: unknown): Promise<AvailabilityContextResult> {
  const session = await requireAuth("STAFF");
  const parsed = contextSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "Pick a valid date range." };
  const { from, to } = parsed.data;
  if (from > to || dayKeysBetween(from, to).length > MAX_AVAILABILITY_DAYS) {
    return { ok: false, error: `Pick ${MAX_AVAILABILITY_DAYS} days or fewer at a time.` };
  }

  const rangeStart = hospitalInstant(addDaysToKey(from, -1), 0);
  const rangeEnd = hospitalInstant(addDaysToKey(to, 2), 0);
  const actor = actorFromSession(session);

  const [availability, shifts] = await Promise.all([
    db.availability.findMany({
      where: { userId: actor.id, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } },
      select: { id: true, startsAt: true, endsAt: true, status: true },
      orderBy: { startsAt: "asc" },
    }),
    db.shift.findMany({
      where: shiftListWhere(actor, {
        assignedWorkerId: actor.id,
        status: { not: "CANCELLED" },
        startsAt: { lt: rangeEnd },
        endsAt: { gt: rangeStart },
      }),
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        roleNeeded: true,
        department: { select: { name: true, code: true } },
      },
      orderBy: { startsAt: "asc" },
    }),
  ]);
  return { ok: true, availability, shifts };
}
