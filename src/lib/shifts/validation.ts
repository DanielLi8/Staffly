import { differenceInHours } from "date-fns";

/**
 * Shift-time rules, kept pure so the client form can block an invalid submit
 * and the server action can return the exact same messages as form state.
 * Never throw for these: Next.js masks thrown server-action errors in
 * production as an opaque "digest" message, which reads as a crash.
 */

export const MIN_BID_LEAD_HOURS = 4;

export const SHIFT_TIME_MESSAGES = {
  endBeforeStart: "End time must be after start time",
  deadlineAfterStart: "Bid deadline must be before the shift start",
  deadlineTooClose: `Bid deadline must be at least ${MIN_BID_LEAD_HOURS} hours before the shift starts`,
} as const;

export type ShiftTimeField = "startsAt" | "endsAt" | "bidDeadlineAt";

export type ShiftFieldErrors = Partial<Record<string, string>>;

export interface ShiftTimes {
  startsAt: Date;
  endsAt: Date;
  bidDeadlineAt: Date;
}

/** Returns a field → message map; an empty object means the times are valid. */
export function validateShiftTimes({
  startsAt,
  endsAt,
  bidDeadlineAt,
}: ShiftTimes): ShiftFieldErrors {
  const errors: ShiftFieldErrors = {};

  if (endsAt <= startsAt) {
    errors.endsAt = SHIFT_TIME_MESSAGES.endBeforeStart;
  }

  if (bidDeadlineAt >= startsAt) {
    errors.bidDeadlineAt = SHIFT_TIME_MESSAGES.deadlineAfterStart;
  } else if (differenceInHours(startsAt, bidDeadlineAt) < MIN_BID_LEAD_HOURS) {
    errors.bidDeadlineAt = SHIFT_TIME_MESSAGES.deadlineTooClose;
  }

  return errors;
}
