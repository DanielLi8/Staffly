import type { DayOfWeek, StaffingRole } from "@prisma/client";

/**
 * Staffing targets ("projected numbers"): how many of each counted role a
 * department's shift needs. PURE: no DB, no clock.
 *
 * The weekly target is stored per day of week; a one-date override wins over
 * it for that hospital day. `effectiveTarget` is the single place that rule
 * lives - the targets editor, the department coverage report and the planner
 * tracker all read through it.
 */

/** JS `getUTCDay()` order, so `DAYS_OF_WEEK[d.getUTCDay()]` works. */
export const DAYS_OF_WEEK: readonly DayOfWeek[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Display order: the app's calendars start the week on Monday. */
export const DISPLAY_DAYS: readonly DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export const WEEKDAYS: readonly DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI"];
export const WEEKEND_DAYS: readonly DayOfWeek[] = ["SAT", "SUN"];

export const DAY_SHORT_LABEL: Record<DayOfWeek, string> = {
  SUN: "Sun",
  MON: "Mon",
  TUE: "Tue",
  WED: "Wed",
  THU: "Thu",
  FRI: "Fri",
  SAT: "Sat",
};

export const DAY_PLURAL_LABEL: Record<DayOfWeek, string> = {
  SUN: "Sundays",
  MON: "Mondays",
  TUE: "Tuesdays",
  WED: "Wednesdays",
  THU: "Thursdays",
  FRI: "Fridays",
  SAT: "Saturdays",
};

/** Upper bound for one role on one shift; anything above is a typo. */
export const MAX_TARGET_COUNT = 99;

export const MAX_OVERRIDE_REASON_LENGTH = 200;

export function isValidTargetCount(count: unknown): count is number {
  return typeof count === "number" && Number.isInteger(count) && count >= 0 && count <= MAX_TARGET_COUNT;
}

/** A real calendar date written as `yyyy-MM-dd` (rejects `2026-02-30`). */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Day of week of a hospital day key. Calendar math only, so no timezone is involved. */
export function dayOfWeekOfKey(dayKey: string): DayOfWeek {
  const [y, m, d] = dayKey.split("-").map(Number);
  return DAYS_OF_WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function isWeekend(day: DayOfWeek): boolean {
  return day === "SAT" || day === "SUN";
}

export interface WeeklyTargetLike {
  templateId: string;
  dayOfWeek: DayOfWeek;
  role: StaffingRole;
  count: number;
}

export interface TargetOverrideLike {
  templateId: string;
  /** Hospital day key. */
  date: string;
  role: StaffingRole;
  count: number;
}

export interface TargetBook<O extends TargetOverrideLike = TargetOverrideLike> {
  weekly: ReadonlyMap<string, number>;
  overrides: ReadonlyMap<string, O>;
}

const weeklyKey = (templateId: string, day: DayOfWeek, role: StaffingRole) => `${templateId}|${day}|${role}`;
const overrideKey = (templateId: string, date: string, role: StaffingRole) => `${templateId}|${date}|${role}`;

/** Index a department's weekly rows and overrides once, then look up per cell. */
export function buildTargetBook<O extends TargetOverrideLike>(
  weekly: readonly WeeklyTargetLike[],
  overrides: readonly O[]
): TargetBook<O> {
  return {
    weekly: new Map(weekly.map((t) => [weeklyKey(t.templateId, t.dayOfWeek, t.role), t.count])),
    overrides: new Map(overrides.map((o) => [overrideKey(o.templateId, o.date, o.role), o])),
  };
}

/** The usual number for that day of week. A missing row means nobody is needed (0). */
export function weeklyTarget(book: TargetBook, templateId: string, day: DayOfWeek, role: StaffingRole): number {
  return book.weekly.get(weeklyKey(templateId, day, role)) ?? 0;
}

export interface EffectiveTarget<O extends TargetOverrideLike = TargetOverrideLike> {
  count: number;
  /** The weekly number for that day of week, whether or not an override replaces it. */
  usual: number;
  source: "OVERRIDE" | "WEEKLY";
  override: O | null;
}

/**
 * The target for one (shift template, hospital day, role): the date's
 * override if there is one, otherwise the weekly number for that day of the
 * week - weekday and weekend days simply carry their own weekly rows.
 */
export function effectiveTarget<O extends TargetOverrideLike>(
  book: TargetBook<O>,
  templateId: string,
  dayKey: string,
  role: StaffingRole
): EffectiveTarget<O> {
  const usual = weeklyTarget(book, templateId, dayOfWeekOfKey(dayKey), role);
  const override = book.overrides.get(overrideKey(templateId, dayKey, role)) ?? null;
  return override
    ? { count: override.count, usual, source: "OVERRIDE", override }
    : { count: usual, usual, source: "WEEKLY", override: null };
}

/**
 * The shared value of a group of days (the editor's "Weekdays" / "Weekends"
 * columns), or null when the days differ - the editor then shows "Varies"
 * and a save sets every day in the group to the new number.
 */
export function groupTarget(
  book: TargetBook,
  templateId: string,
  role: StaffingRole,
  days: readonly DayOfWeek[]
): number | null {
  const values = days.map((d) => weeklyTarget(book, templateId, d, role));
  return values.every((v) => v === values[0]) ? values[0] : null;
}
