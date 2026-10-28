import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { addDaysToKey } from "@/lib/timezone";
import {
  applySundayNumbers,
  loadStaffingTargets,
  removeTargetOverride,
  saveWeeklyTargets,
  setShiftPattern,
  setTargetOverride,
  todayKey,
  updateShiftTemplate,
} from "@/lib/staffing/store";
import { buildTargetBook, effectiveTarget } from "@/lib/staffing/targets";

/**
 * The staffing targets store against real Postgres: every write leaves an
 * audit row naming who changed what, a stale or concurrent write is refused
 * rather than silently overwriting, and overrides win for their date only.
 *
 * Runs only via `pnpm test:db`, against a SEEDED, DISPOSABLE database. It
 * works on the Emergency department (the seed gives it no targets) and puts
 * the department back the way it found it.
 */

let deptId: string;
let adminId: string;
let day: { id: string; startMinute: number; endMinute: number; leadRequired: boolean };
let night: { id: string };
const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI"] as const;

async function reset() {
  await db.staffingTargetOverride.deleteMany({ where: { template: { departmentId: deptId } } });
  await db.staffingTarget.deleteMany({ where: { template: { departmentId: deptId } } });
  await db.auditLog.deleteMany({ where: { targetType: "Department", targetId: deptId } });
  await db.shiftTemplate.update({ where: { id: day.id }, data: { startMinute: 420, endMinute: 900, leadRequired: true } });
  await db.department.update({ where: { id: deptId }, data: { shiftPattern: "EIGHT_HOUR" } });
}

async function auditRows() {
  return db.auditLog.findMany({ where: { targetType: "Department", targetId: deptId }, orderBy: { createdAt: "asc" } });
}

beforeAll(async () => {
  const [er, admin] = await Promise.all([
    db.department.findUniqueOrThrow({ where: { code: "ER" } }),
    db.user.findUniqueOrThrow({ where: { email: "admin@staffly.com" } }),
  ]);
  deptId = er.id;
  adminId = admin.id;
  day = await db.shiftTemplate.findUniqueOrThrow({ where: { departmentId_code: { departmentId: deptId, code: "D" } } });
  night = await db.shiftTemplate.findUniqueOrThrow({ where: { departmentId_code: { departmentId: deptId, code: "N" } } });
  await reset();
});

afterAll(async () => {
  if (deptId) await reset();
  await db.$disconnect();
});

describe("staffing targets store (Postgres)", () => {
  it("every department has the default 8 h and 12 h shift definitions", async () => {
    const templates = await db.shiftTemplate.findMany({ where: { departmentId: deptId }, orderBy: { code: "asc" } });
    expect(templates.map((t) => [t.code, t.pattern, t.startMinute, t.endMinute])).toEqual([
      ["D", "EIGHT_HOUR", 420, 900],
      ["D12", "TWELVE_HOUR", 420, 1140],
      ["E", "EIGHT_HOUR", 900, 1380],
      ["N", "EIGHT_HOUR", 1380, 420],
      ["N12", "TWELVE_HOUR", 1140, 420],
    ]);
  });

  it("saves a weekday number for Mon-Fri and audits who changed it", async () => {
    const result = await saveWeeklyTargets(adminId, {
      departmentId: deptId,
      changes: [{ templateId: day.id, role: "RN", days: [...WEEKDAYS], before: [0, 0, 0, 0, 0], count: 4 }],
    });
    expect(result).toEqual({ ok: true, message: "Saved 1 change." });

    const rows = await db.staffingTarget.findMany({ where: { templateId: day.id, role: "RN" } });
    expect(rows.map((r) => r.dayOfWeek).sort()).toEqual(["FRI", "MON", "THU", "TUE", "WED"]);
    expect(rows.every((r) => r.count === 4 && r.setById === adminId)).toBe(true);

    const [audit] = await auditRows();
    expect(audit).toMatchObject({ actorId: adminId, action: "STAFFING_TARGET_CHANGED", targetId: deptId });
    expect(audit.metadata).toMatchObject({ templateCode: "D", role: "RN", days: [...WEEKDAYS], before: [0, 0, 0, 0, 0], after: 4 });

    const view = await loadStaffingTargets(deptId);
    expect(view?.history[0]).toMatchObject({ actorName: "Sarah Chen", line: "Day RN, Weekdays: 0 → 4" });
  });

  it("refuses a save made from stale numbers, writing nothing", async () => {
    const before = (await auditRows()).length;
    const result = await saveWeeklyTargets(adminId, {
      departmentId: deptId,
      changes: [{ templateId: day.id, role: "RN", days: ["MON"], before: [3], count: 6 }],
    });
    expect(result).toMatchObject({ ok: false, reason: "STALE" });
    expect((await auditRows()).length).toBe(before);
    expect((await db.staffingTarget.findFirstOrThrow({ where: { templateId: day.id, role: "RN", dayOfWeek: "MON" } })).count).toBe(4);
  });

  it("lets only one of two admins saving from the same numbers win", async () => {
    const change = (count: number) =>
      saveWeeklyTargets(adminId, {
        departmentId: deptId,
        changes: [{ templateId: day.id, role: "RN", days: ["MON"], before: [4], count }],
      });
    const results = await Promise.all([change(5), change(7)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "STALE")).toHaveLength(1);
    const winner = results[0].ok ? 5 : 7;
    expect((await db.staffingTarget.findFirstOrThrow({ where: { templateId: day.id, role: "RN", dayOfWeek: "MON" } })).count).toBe(winner);
  });

  it("an override wins for its date only, and setting it back to the usual number removes it", async () => {
    const today = todayKey();
    // The next Tuesday at least a week out, so the usual Day RN is 4.
    let date = addDaysToKey(today, 7);
    while (new Date(`${date}T12:00:00Z`).getUTCDay() !== 2) date = addDaysToKey(date, 1);

    const set = await setTargetOverride(adminId, { templateId: day.id, date, role: "RN", count: 6, reason: "Census", expected: null });
    expect(set).toMatchObject({ ok: true });

    const [weekly, overrides] = await Promise.all([
      db.staffingTarget.findMany({ where: { templateId: day.id } }),
      db.staffingTargetOverride.findMany({ where: { templateId: day.id } }),
    ]);
    const book = buildTargetBook(weekly, overrides);
    expect(effectiveTarget(book, day.id, date, "RN")).toMatchObject({ count: 6, usual: 4, source: "OVERRIDE" });
    expect(effectiveTarget(book, day.id, addDaysToKey(date, 7), "RN")).toMatchObject({ count: 4, source: "WEEKLY" });

    // Someone else's view of "no override yet" is now stale.
    expect(
      await setTargetOverride(adminId, { templateId: day.id, date, role: "RN", count: 7, reason: null, expected: null })
    ).toMatchObject({ ok: false, reason: "STALE" });

    const back = await setTargetOverride(adminId, { templateId: day.id, date, role: "RN", count: 4, reason: null, expected: 6 });
    expect(back).toMatchObject({ ok: true });
    expect(await db.staffingTargetOverride.count({ where: { templateId: day.id } })).toBe(0);

    const actions = (await auditRows()).slice(-2).map((r) => r.action);
    expect(actions).toEqual(["STAFFING_OVERRIDE_SET", "STAFFING_OVERRIDE_REMOVED"]);
  });

  it("refuses an override for a past date", async () => {
    const yesterday = addDaysToKey(todayKey(), -1);
    expect(
      await setTargetOverride(adminId, { templateId: day.id, date: yesterday, role: "RN", count: 2, reason: null, expected: null })
    ).toMatchObject({ ok: false, reason: "PAST_DATE" });
  });

  it("removes an override once, and says so the second time", async () => {
    const date = addDaysToKey(todayKey(), 3);
    await setTargetOverride(adminId, { templateId: night.id, date, role: "PSW", count: 2, reason: null, expected: null });
    const o = await db.staffingTargetOverride.findFirstOrThrow({ where: { templateId: night.id, date } });
    expect(await removeTargetOverride(adminId, { overrideId: o.id })).toMatchObject({ ok: true });
    expect(await removeTargetOverride(adminId, { overrideId: o.id })).toMatchObject({ ok: false, reason: "STALE" });
  });

  it("the holiday shortcut gives a date the Sunday numbers", async () => {
    await saveWeeklyTargets(adminId, {
      departmentId: deptId,
      changes: [{ templateId: day.id, role: "RN", days: ["SUN"], before: [0], count: 2 }],
    });
    let date = addDaysToKey(todayKey(), 1);
    while (new Date(`${date}T12:00:00Z`).getUTCDay() !== 3) date = addDaysToKey(date, 1); // a Wednesday

    expect(await applySundayNumbers(adminId, { departmentId: deptId, date, reason: "Stat holiday" })).toMatchObject({ ok: true });
    const overrides = await db.staffingTargetOverride.findMany({ where: { template: { departmentId: deptId }, date } });
    // Day RN differs from Sunday (4 vs 2); every other cell is 0 both ways, so no override.
    expect(overrides.map((o) => [o.templateId, o.role, o.count, o.reason])).toEqual([[day.id, "RN", 2, "Stat holiday"]]);
    expect(await applySundayNumbers(adminId, { departmentId: deptId, date, reason: "Stat holiday" })).toMatchObject({
      ok: false,
      reason: "NO_CHANGE",
    });
  });

  it("changes shift times and length, refusing a stale edit", async () => {
    const before = { startMinute: 420, endMinute: 900, leadRequired: true };
    const after = { startMinute: 450, endMinute: 930, leadRequired: false };
    expect(await updateShiftTemplate(adminId, { templateId: day.id, before, after })).toMatchObject({ ok: true });
    expect(await updateShiftTemplate(adminId, { templateId: day.id, before, after: before })).toMatchObject({
      ok: false,
      reason: "STALE",
    });

    expect(await setShiftPattern(adminId, { departmentId: deptId, from: "EIGHT_HOUR", to: "TWELVE_HOUR" })).toMatchObject({ ok: true });
    expect(await setShiftPattern(adminId, { departmentId: deptId, from: "EIGHT_HOUR", to: "TWELVE_HOUR" })).toMatchObject({
      ok: false,
      reason: "STALE",
    });

    const view = await loadStaffingTargets(deptId);
    expect(view?.history.slice(0, 2).map((h) => h.line)).toEqual([
      "Switched from 8-hour shifts to 12-hour shifts",
      "Day shift: 07:00-15:00 → 07:30-15:30, Team Lead no longer required",
    ]);
  });
});
