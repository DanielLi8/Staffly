/**
 * Hour and day counting shared by the rule checker, Shift Swap eligibility and
 * the callout bidder list's weekly projection. PURE: no DB, no clock.
 *
 * Hours are real elapsed time (`endsAt - startsAt`), so the fall-back night
 * (23:00 -> 07:00 across the DST change) counts 9 h, not 8.
 */
import { addDaysToKey, hospitalDate } from "@/lib/timezone";
import { isSamePayPeriod } from "./pay-period";

export interface HoursWindow {
  startsAt: Date;
  endsAt: Date;
}

/** Duration of a window in hours. Never negative. */
export function windowHours(window: HoursWindow): number {
  const ms = window.endsAt.getTime() - window.startsAt.getTime();
  return ms > 0 ? ms / 3_600_000 : 0;
}

/**
 * Total hours of `shifts` in the pay period containing `at`. A shift belongs
 * to the pay period its START falls in, so a night crossing the period
 * boundary counts once, in full, in the period it began.
 */
export function payPeriodHours(shifts: HoursWindow[], at: Date): number {
  return shifts.filter((s) => isSamePayPeriod(s.startsAt, at)).reduce((total, s) => total + windowHours(s), 0);
}

/**
 * Length of the run of consecutive hospital-calendar days that have a shift,
 * through the day `at` falls on (that day counts as worked). A shift counts
 * for the day it STARTS on: a Night ending 07:00 and a Day starting 07:00 on
 * the same calendar day are one day, and two shifts a calendar day apart are
 * not consecutive however few hours separate them.
 */
export function consecutiveDayStreak(shifts: HoursWindow[], at: Date): number {
  const days = new Set(shifts.map((s) => hospitalDate(s.startsAt)));
  const anchor = hospitalDate(at);
  days.add(anchor);

  let streak = 1;
  for (let key = addDaysToKey(anchor, -1); days.has(key); key = addDaysToKey(key, -1)) streak++;
  for (let key = addDaysToKey(anchor, 1); days.has(key); key = addDaysToKey(key, 1)) streak++;
  return streak;
}
