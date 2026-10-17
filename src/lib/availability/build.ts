import type { AvailabilityStatus } from "@prisma/client";
import { hospitalInstant } from "@/lib/timezone";
import { MINUTES_PER_DAY } from "@/lib/schedule/time-grid";
import { blockValidationError, isOvernight, type AvailabilityBlock } from "./blocks";

/**
 * Turns a set of selected hospital days plus a shared list of time-of-day
 * blocks into the one-Availability-row-per-block-per-day shape
 * `src/lib/callout/tiers.ts` already reads (it matches by overlapping
 * `startsAt`/`endsAt` windows, so a partial-day UNAVAILABLE block works the
 * same as a full-day one there). Every block applies to every selected day;
 * an overnight block (`endMinute <= startMinute`) ends on the following
 * morning. Instants are built on the hospital clock (`hospitalInstant`), never
 * the server's TZ. Kept pure (no DB) so the client-side guard and the server
 * action share one interpretation, matching `src/lib/shifts/validation.ts`.
 */

export interface AvailabilityRowDraft {
  dayKey: string;
  startsAt: Date;
  endsAt: Date;
  status: AvailabilityStatus;
}

export type BuildAvailabilityRowsResult =
  | { ok: true; rows: AvailabilityRowDraft[] }
  | { ok: false; error: string };

/** A season of availability in one save; also bounds the server action's work. */
export const MAX_AVAILABILITY_DAYS = 92;

export const AVAILABILITY_MESSAGES = {
  noDaysSelected: "Select at least one day.",
  noBlocks: "Pick a preset or add a time range.",
  tooManyDays: `Pick ${MAX_AVAILABILITY_DAYS} days or fewer at a time.`,
} as const;

export function buildAvailabilityRows(dayKeys: string[], blocks: AvailabilityBlock[]): BuildAvailabilityRowsResult {
  if (dayKeys.length === 0) return { ok: false, error: AVAILABILITY_MESSAGES.noDaysSelected };
  if (dayKeys.length > MAX_AVAILABILITY_DAYS) return { ok: false, error: AVAILABILITY_MESSAGES.tooManyDays };
  if (blocks.length === 0) return { ok: false, error: AVAILABILITY_MESSAGES.noBlocks };

  for (const block of blocks) {
    const error = blockValidationError(block);
    if (error) return { ok: false, error };
  }

  const rows: AvailabilityRowDraft[] = [];
  for (const dayKey of Array.from(new Set(dayKeys)).sort()) {
    for (const block of blocks) {
      const end = isOvernight(block) ? block.endMinute + MINUTES_PER_DAY : block.endMinute;
      rows.push({
        dayKey,
        startsAt: hospitalInstant(dayKey, block.startMinute),
        endsAt: hospitalInstant(dayKey, end),
        status: block.status,
      });
    }
  }
  return { ok: true, rows };
}
