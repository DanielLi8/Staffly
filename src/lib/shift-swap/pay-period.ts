/**
 * Pay-period boundaries for Shift Swap / Giveaway eligibility.
 *
 * PURE: no DB, no session. A fixed, ongoing 2-week cycle anchored to Sunday,
 * Aug 23, 2026 - "Aug 23 to Sep 5 inclusive" is one full period (the captain's
 * own example). Periods repeat indefinitely in both directions from that
 * anchor, so any date - past or future - resolves to exactly one period.
 *
 * Classification uses the HOSPITAL-timezone calendar day, not server or
 * viewer local time, matching `classifyShiftType` (`src/lib/shifts/shift-type.ts`):
 * a pay-period cutoff is a hard eligibility rule (allowed/blocked), so it must
 * land on the same day for every caller regardless of what timezone the
 * request happens to run in. This is a different concern from the day/week/
 * month schedule GRID range (`resolveScheduleRange`), which deliberately
 * stays in plain local time to match the calendar the viewer is looking at.
 */
import { addDays, differenceInCalendarDays } from "date-fns";
import { hospitalDate } from "@/lib/timezone";

/** Sunday, Aug 23, 2026 - the first day of the anchor pay period. */
export const PAY_PERIOD_ANCHOR = "2026-08-23";

export const PAY_PERIOD_LENGTH_DAYS = 14;

export interface PayPeriod {
  /** Inclusive first calendar day of the period (hospital-timezone), as a local-midnight Date. */
  start: Date;
  /** Inclusive last calendar day of the period (hospital-timezone), as a local-midnight Date. */
  end: Date;
}

/**
 * Parses a `yyyy-MM-dd` calendar-day key into a local-midnight `Date`. Not a
 * timezone conversion - this and {@link calendarDateKey} are a matched pair
 * used only to do calendar-day arithmetic (addDays, differenceInCalendarDays)
 * on the day a `hospitalDate()` string names, independent of the host's own
 * timezone.
 */
export function parseCalendarDate(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** The `yyyy-MM-dd` key for a local-midnight calendar-day `Date` (the inverse of {@link parseCalendarDate}). */
export function calendarDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The pay-period window containing `date`, identified by the hospital-timezone calendar day it falls on. */
export function payPeriodFor(date: Date): PayPeriod {
  const anchor = parseCalendarDate(PAY_PERIOD_ANCHOR);
  const day = parseCalendarDate(hospitalDate(date));

  const daysSinceAnchor = differenceInCalendarDays(day, anchor);
  // Math.floor (not truncation) so dates before the anchor still resolve to
  // the correct preceding period instead of rounding toward zero.
  const periodIndex = Math.floor(daysSinceAnchor / PAY_PERIOD_LENGTH_DAYS);

  const start = addDays(anchor, periodIndex * PAY_PERIOD_LENGTH_DAYS);
  const end = addDays(start, PAY_PERIOD_LENGTH_DAYS - 1);
  return { start, end };
}

/** Whether `a` and `b` fall in the same pay period. */
export function isSamePayPeriod(a: Date, b: Date): boolean {
  return payPeriodFor(a).start.getTime() === payPeriodFor(b).start.getTime();
}
