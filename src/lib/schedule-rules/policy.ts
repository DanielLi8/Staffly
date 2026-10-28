/**
 * The numbers the schedule rule checker enforces.
 *
 * PURE: no DB. Callers resolve a hospital's policy with
 * {@link schedulePolicyFor} (fed the `Hospital` row's settings) and pass it to
 * `evaluateAssignment`; tests pass their own.
 */

/**
 * Minimum rest between the end of one shift and the start of the next, in
 * hours, when the hospital has not set its own (`Hospital.minRestHours` is
 * null).
 *
 * PROVISIONAL: the real number comes from the union contract, which the
 * captain has not given yet (decision `double-booking-override`). 12 h is the
 * rest rule the captain set for the held per-person editor (C1) and the
 * planner plan's working default. When the contract number arrives, set it on
 * the hospital (`Hospital.minRestHours`) - or change this default if it holds
 * for every hospital.
 */
export const DEFAULT_MIN_REST_HOURS = 12;

/**
 * Hours in one 14-day pay period at which a worker is on overtime. Reaching
 * this line counts: the captain's rule is "75 hours and above" (decision
 * `overtime-line`). Fixed for every hospital, not a setting.
 */
export const PAY_PERIOD_OVERTIME_HOURS = 75;

/** Consecutive hospital-calendar days with a shift at which a reason is required. */
export const MAX_CONSECUTIVE_DAYS = 7;

/**
 * Two of a person's shifts at most this far apart (end to start) are a
 * back-to-back double - Days then Evenings the same day, a Night straight into
 * a Day, or the reverse - which is overtime (decision `overtime-line`). The
 * captain's examples all touch end to start; an hour covers a short handover
 * gap without calling an ordinary short-rest booking a double.
 */
export const DOUBLE_MAX_GAP_MINUTES = 60;

export interface SchedulePolicy {
  /** Under this many hours between two shifts is short rest (double booking). */
  minRestHours: number;
  /** Reaching this many hours in a pay period is overtime. */
  payPeriodOvertimeHours: number;
  /** This many consecutive days with a shift needs a reason. */
  maxConsecutiveDays: number;
  /** Shifts at most this many minutes apart are a back-to-back double. */
  doubleMaxGapMinutes: number;
}

export const SCHEDULE_POLICY: SchedulePolicy = {
  minRestHours: DEFAULT_MIN_REST_HOURS,
  payPeriodOvertimeHours: PAY_PERIOD_OVERTIME_HOURS,
  maxConsecutiveDays: MAX_CONSECUTIVE_DAYS,
  doubleMaxGapMinutes: DOUBLE_MAX_GAP_MINUTES,
};

/**
 * The policy for a hospital: its `minRestHours` setting when set to a sane
 * value (0-24 h), otherwise {@link DEFAULT_MIN_REST_HOURS}. Everything else
 * is fixed by captain decision, so it is not per hospital.
 */
export function schedulePolicyFor(hospital: { minRestHours: number | null } | null | undefined): SchedulePolicy {
  const configured = hospital?.minRestHours;
  const valid = typeof configured === "number" && Number.isFinite(configured) && configured >= 0 && configured <= 24;
  return { ...SCHEDULE_POLICY, minRestHours: valid ? configured : DEFAULT_MIN_REST_HOURS };
}
