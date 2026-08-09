/**
 * Overtime projection for the seniority-ranked bidder list.
 *
 * PURE: no DB, no clock. The caller passes the bidder's already-ASSIGNED shifts;
 * this decides whether awarding one more shift would tip them over the weekly
 * hours threshold, and by how much.
 *
 * SIMPLIFICATION: a real collective agreement computes overtime from far more
 * than a weekly hours total - daily thresholds, consecutive-day premiums,
 * classification, paid leave that counts toward hours, banked time, and
 * scheduled-vs-worked distinctions all matter, and the exact rule differs per
 * bargaining unit. This is a deliberate stand-in: one configurable weekly
 * threshold (default 40h) over a Sunday-start work week, counting only shifts
 * already ASSIGNED to that person. It is a scheduler-facing WARNING, never a
 * hard block - the scheduler still awards by seniority.
 */
import { startOfWeek, endOfWeek } from "date-fns";

/** Default weekly hours before overtime. Overridable per call. */
export const DEFAULT_WEEKLY_OT_THRESHOLD_HOURS = 40;

/**
 * Day the work week starts on, date-fns style (0 = Sunday). Sunday matches the
 * most common North American hospital payroll week.
 */
export const DEFAULT_WEEK_STARTS_ON = 0;

export interface HoursWindow {
  startsAt: Date;
  endsAt: Date;
}

export interface OvertimeProjection {
  /** Inclusive start of the work week the target shift falls in. */
  weekStart: Date;
  /** End of that work week. */
  weekEnd: Date;
  /** Hours already assigned to this person inside that week. */
  assignedHours: number;
  /** Hours the target shift itself adds. */
  shiftHours: number;
  /** assignedHours + shiftHours. */
  projectedHours: number;
  thresholdHours: number;
  /** True when awarding this shift would push the person past the threshold. */
  isOvertime: boolean;
  /** How far past the threshold the award would go; 0 when not in overtime. */
  overtimeHours: number;
}

/** Duration of a window in hours. Never negative. */
export function windowHours(window: HoursWindow): number {
  const ms = window.endsAt.getTime() - window.startsAt.getTime();
  return ms > 0 ? ms / 3_600_000 : 0;
}

/**
 * The work week containing `date`. A shift is attributed to the week its START
 * falls in, so an overnight shift crossing the week boundary counts once, in the
 * week it began - another simplification a real agreement would spell out.
 */
export function workWeekBounds(
  date: Date,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = DEFAULT_WEEK_STARTS_ON
): { weekStart: Date; weekEnd: Date } {
  return {
    weekStart: startOfWeek(date, { weekStartsOn }),
    weekEnd: endOfWeek(date, { weekStartsOn }),
  };
}

/**
 * Project the bidder's weekly hours if they were awarded `targetShift`.
 *
 * `assignedShifts` must be the shifts ALREADY assigned to this bidder. Shifts
 * outside the target shift's work week are ignored here (rather than trusting
 * the caller to pre-filter), and the target shift is excluded by id if it
 * somehow appears in the list, so re-projecting an award cannot double count.
 */
export function projectOvertime(input: {
  targetShift: HoursWindow & { id?: string };
  assignedShifts: (HoursWindow & { id?: string })[];
  thresholdHours?: number;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}): OvertimeProjection {
  const thresholdHours = input.thresholdHours ?? DEFAULT_WEEKLY_OT_THRESHOLD_HOURS;
  const { weekStart, weekEnd } = workWeekBounds(
    input.targetShift.startsAt,
    input.weekStartsOn ?? DEFAULT_WEEK_STARTS_ON
  );

  const assignedHours = input.assignedShifts
    .filter((s) => s.startsAt >= weekStart && s.startsAt <= weekEnd)
    .filter((s) => !(s.id && input.targetShift.id && s.id === input.targetShift.id))
    .reduce((total, s) => total + windowHours(s), 0);

  const shiftHours = windowHours(input.targetShift);
  const projectedHours = assignedHours + shiftHours;
  // Strictly greater than: landing exactly on the threshold is not overtime.
  const isOvertime = projectedHours > thresholdHours;

  return {
    weekStart,
    weekEnd,
    assignedHours,
    shiftHours,
    projectedHours,
    thresholdHours,
    isOvertime,
    overtimeHours: isOvertime ? projectedHours - thresholdHours : 0,
  };
}
