import { addMinutes, startOfDay } from "date-fns";
import type { AvailabilityStatus } from "@prisma/client";
import { parseTimeInput } from "@/lib/shifts/time";

/**
 * Turns a set of selected calendar days plus a shared list of time-of-day
 * blocks into the one-Availability-row-per-block-per-day shape
 * `src/lib/callout/tiers.ts` already reads (it matches by overlapping
 * `startsAt`/`endsAt` windows, so a partial-day UNAVAILABLE block works the
 * same as a full-day one there). Every block - AVAILABLE or UNAVAILABLE -
 * carries its own time range and applies to every selected day, so one day
 * can end up with several rows (e.g. AVAILABLE 07:00-12:00 and UNAVAILABLE
 * 12:00-15:00). Kept pure (no DB) so both the client-side submit guard and
 * the server action share one interpretation, matching
 * `src/lib/shifts/validation.ts`.
 */

export interface AvailabilityRowDraft {
  day: Date;
  startsAt: Date;
  endsAt: Date;
  status: AvailabilityStatus;
}

export interface AvailabilityBlockDraft {
  status: Extract<AvailabilityStatus, "AVAILABLE" | "UNAVAILABLE">;
  from: string;
  to: string;
}

export type BuildAvailabilityRowsResult =
  | { ok: true; rows: AvailabilityRowDraft[] }
  | { ok: false; error: string };

export const AVAILABILITY_MESSAGES = {
  noDaysSelected: "Select at least one day.",
  noBlocks: "Add at least one time block.",
  invalidFrom: "Enter a valid start time.",
  invalidTo: "Enter a valid end time.",
  endBeforeStart: "End time must be after start time.",
} as const;

export function buildAvailabilityRows(
  days: Date[],
  blocks: AvailabilityBlockDraft[]
): BuildAvailabilityRowsResult {
  if (days.length === 0) {
    return { ok: false, error: AVAILABILITY_MESSAGES.noDaysSelected };
  }
  if (blocks.length === 0) {
    return { ok: false, error: AVAILABILITY_MESSAGES.noBlocks };
  }

  const parsedBlocks: { status: AvailabilityStatus; fromMinutes: number; toMinutes: number }[] = [];
  for (const block of blocks) {
    const from = parseTimeInput(block.from);
    if (!from) return { ok: false, error: AVAILABILITY_MESSAGES.invalidFrom };
    const to = parseTimeInput(block.to);
    if (!to) return { ok: false, error: AVAILABILITY_MESSAGES.invalidTo };

    const fromMinutes = from.hours * 60 + from.minutes;
    const toMinutes = to.hours * 60 + to.minutes;
    if (toMinutes <= fromMinutes) {
      return { ok: false, error: AVAILABILITY_MESSAGES.endBeforeStart };
    }
    parsedBlocks.push({ status: block.status, fromMinutes, toMinutes });
  }

  const rows: AvailabilityRowDraft[] = [];
  for (const day of days) {
    const dayStart = startOfDay(day);
    for (const block of parsedBlocks) {
      const startsAt = addMinutes(dayStart, block.fromMinutes);
      const endsAt = addMinutes(dayStart, block.toMinutes);
      rows.push({ day, startsAt, endsAt, status: block.status });
    }
  }

  return { ok: true, rows };
}
