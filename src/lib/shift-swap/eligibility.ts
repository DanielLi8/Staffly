/**
 * Receiving-side eligibility for a Shift Swap / Giveaway pickup.
 *
 * PURE: no DB, no clock. Counts with the schedule rule checker's helpers
 * (`src/lib/schedule-rules/`) but keeps the swap's own hard-block semantics
 * - the two rules the mockup's Step 2 blocks on, scoped to the PAY PERIOD:
 *
 *   1. Total scheduled hours for the pay period would exceed 75.
 *   2. Picking up the shift would create 7 CONSECUTIVE CALENDAR DAYS
 *      (hospital-timezone) each having at least one assigned shift.
 *
 * "Consecutive" here is a judgment call the brief asked to be stated
 * explicitly: it is calendar-day adjacency with an assigned shift on each
 * day, not elapsed hours or a specific shift-time relationship (e.g. a Night
 * shift ending 07:00 followed by a Day shift starting 07:00 the same
 * calendar day both count, and two shifts a calendar day apart are NOT
 * consecutive even if only a few hours separate them). This matches how the
 * seed data's "day off" rest days are modeled (a day with no assigned shift
 * at all) and keeps the rule simple enough to explain in the blocked-reason
 * copy the UI must show verbatim.
 */
import { consecutiveDayStreak, payPeriodHours, windowHours, type HoursWindow } from "@/lib/schedule-rules/hours";
import { MAX_CONSECUTIVE_DAYS, PAY_PERIOD_OVERTIME_HOURS } from "@/lib/schedule-rules/policy";

export const MAX_PAY_PERIOD_HOURS = PAY_PERIOD_OVERTIME_HOURS;
export const MAX_CONSECUTIVE_SHIFT_DAYS = MAX_CONSECUTIVE_DAYS;

export type SwapEligibilityReason = "EXCEEDS_PAY_PERIOD_HOURS" | "EXCEEDS_CONSECUTIVE_SHIFTS";

/** A shift window with an optional id, so a shift appearing in both `newShift` and `existingShifts` (re-projecting an already-assigned shift) can be de-duplicated. */
export type EligibilityShift = HoursWindow & { id?: string };

/** The exact blocked-reason copy the UI must surface next to a grayed-out entry, matching the mockup verbatim. */
export const SWAP_ELIGIBILITY_MESSAGES: Record<SwapEligibilityReason, string> = {
  EXCEEDS_PAY_PERIOD_HOURS: `would exceed ${MAX_PAY_PERIOD_HOURS} hrs this pay period`,
  EXCEEDS_CONSECUTIVE_SHIFTS: `would be ${MAX_CONSECUTIVE_SHIFT_DAYS} consecutive shifts`,
};

export type SwapEligibilityResult =
  | { eligible: true; reason: null; message: null }
  | { eligible: false; reason: SwapEligibilityReason; message: string };

/**
 * Would `person` (the receiving side) be eligible to pick up `newShift`,
 * given the shifts already assigned to them?
 *
 * `existingShifts` should include every shift already assigned to this
 * person within roughly a week on either side of `newShift` - enough for the
 * consecutive-day streak to see past the pay-period boundary if the streak
 * crosses it. A shift sharing `newShift`'s id (re-projecting an already-
 * assigned shift) is ignored so it is never double-counted.
 */
export function evaluateReceivingEligibility(
  newShift: EligibilityShift,
  existingShifts: EligibilityShift[]
): SwapEligibilityResult {
  const relevant = existingShifts.filter((s) => !(newShift.id && s.id === newShift.id));

  const periodHours = payPeriodHours(relevant, newShift.startsAt) + windowHours(newShift);

  if (periodHours > MAX_PAY_PERIOD_HOURS) {
    return {
      eligible: false,
      reason: "EXCEEDS_PAY_PERIOD_HOURS",
      message: SWAP_ELIGIBILITY_MESSAGES.EXCEEDS_PAY_PERIOD_HOURS,
    };
  }

  if (consecutiveDayStreak(relevant, newShift.startsAt) >= MAX_CONSECUTIVE_SHIFT_DAYS) {
    return {
      eligible: false,
      reason: "EXCEEDS_CONSECUTIVE_SHIFTS",
      message: SWAP_ELIGIBILITY_MESSAGES.EXCEEDS_CONSECUTIVE_SHIFTS,
    };
  }

  return { eligible: true, reason: null, message: null };
}
