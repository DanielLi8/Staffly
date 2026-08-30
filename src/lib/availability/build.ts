import { addDays, startOfDay, setHours, setMinutes } from "date-fns";
import type { AvailabilityStatus } from "@prisma/client";
import { parseTimeInput } from "@/lib/shifts/time";

/**
 * Turns a set of selected calendar days plus one shared action (a time range,
 * or a flat "unavailable") into the one-Availability-row-per-day shape
 * `prisma/seed.ts` already seeds and `src/lib/callout/tiers.ts` already reads.
 * Kept pure (no DB) so both the client-side submit guard and the server
 * action share one interpretation, matching `src/lib/shifts/validation.ts`.
 */

export interface AvailabilityRowDraft {
  day: Date;
  startsAt: Date;
  endsAt: Date;
  status: AvailabilityStatus;
}

export type BuildAvailabilityRowsResult =
  | { ok: true; rows: AvailabilityRowDraft[] }
  | { ok: false; error: string };

export const AVAILABILITY_MESSAGES = {
  noDaysSelected: "Select at least one day.",
  timeRequired: "Enter a start and end time.",
  invalidFrom: "Enter a valid start time.",
  invalidTo: "Enter a valid end time.",
  endBeforeStart: "End time must be after start time.",
} as const;

/**
 * `mode: "UNAVAILABLE"` needs no time range - it blocks the entire calendar
 * day. `mode: "AVAILABLE"` applies one From/To time-of-day to every day.
 */
export function buildAvailabilityRows(
  days: Date[],
  mode: Extract<AvailabilityStatus, "AVAILABLE" | "UNAVAILABLE">,
  time?: { from: string; to: string }
): BuildAvailabilityRowsResult {
  if (days.length === 0) {
    return { ok: false, error: AVAILABILITY_MESSAGES.noDaysSelected };
  }

  if (mode === "UNAVAILABLE") {
    return {
      ok: true,
      rows: days.map((day) => {
        const dayStart = startOfDay(day);
        return { day, startsAt: dayStart, endsAt: addDays(dayStart, 1), status: "UNAVAILABLE" as const };
      }),
    };
  }

  if (!time) return { ok: false, error: AVAILABILITY_MESSAGES.timeRequired };

  const from = parseTimeInput(time.from);
  if (!from) return { ok: false, error: AVAILABILITY_MESSAGES.invalidFrom };

  const to = parseTimeInput(time.to);
  if (!to) return { ok: false, error: AVAILABILITY_MESSAGES.invalidTo };

  const rows = days.map((day) => {
    const dayStart = startOfDay(day);
    const startsAt = setMinutes(setHours(dayStart, from.hours), from.minutes);
    const endsAt = setMinutes(setHours(dayStart, to.hours), to.minutes);
    return { day, startsAt, endsAt, status: "AVAILABLE" as const };
  });

  if (rows.some((r) => r.endsAt <= r.startsAt)) {
    return { ok: false, error: AVAILABILITY_MESSAGES.endBeforeStart };
  }

  return { ok: true, rows };
}
