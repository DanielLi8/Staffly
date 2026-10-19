/**
 * Shift-time rules, kept pure so the client form can block an invalid submit
 * and the server action can return the exact same messages as form state.
 * Never throw for these: Next.js masks thrown server-action errors in
 * production as an opaque "digest" message, which reads as a crash.
 *
 * There is no minimum lead time and no bid deadline: any shift that has not
 * started yet can be posted, and it takes bids until it is filled (see
 * `bidAcceptance` in ./bid-window). Sick calls are usually hours, not days,
 * before the shift.
 */

export const SHIFT_TIME_MESSAGES = {
  endBeforeStart: "End time must be after start time",
  startInPast: "Shift start must be in the future",
} as const;

export type ShiftTimeField = "startsAt" | "endsAt";

export type ShiftFieldErrors = Partial<Record<string, string>>;

export interface ShiftTimes {
  startsAt: Date;
  endsAt: Date;
}

/** Returns a field → message map; an empty object means the times are valid. */
export function validateShiftTimes(
  { startsAt, endsAt }: ShiftTimes,
  now = new Date()
): ShiftFieldErrors {
  const errors: ShiftFieldErrors = {};

  if (startsAt <= now) {
    errors.startsAt = SHIFT_TIME_MESSAGES.startInPast;
  }

  if (endsAt <= startsAt) {
    errors.endsAt = SHIFT_TIME_MESSAGES.endBeforeStart;
  }

  return errors;
}
