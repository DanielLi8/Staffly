import { addDaysToKey, hospitalDate, hospitalInstant } from "@/lib/timezone";
import type { TimedItem } from "@/lib/schedule/time-grid";
import type { AvailabilityRowLike } from "./blocks";

/**
 * Does a shift sit inside the availability the worker declared? Drives the
 * amber conflict marker on the schedule grid and the editor's warning before
 * a save. Pure; works on instants, so an overnight shift is checked against
 * both days it touches.
 *
 * - `UNAVAILABLE`: an Unavailable block overlaps the shift (the same rule
 *   that drops someone from the callout cascade in `tiers.ts`).
 * - `OUTSIDE_AVAILABILITY`: the worker declared Available time on a day the
 *   shift touches, but those windows don't cover the whole shift.
 * - null: covered, or nothing declared for those days ("not set" is not a
 *   conflict).
 */
export type ShiftAvailabilityConflict = "UNAVAILABLE" | "OUTSIDE_AVAILABILITY";

function overlaps(a: TimedItem, b: TimedItem): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

function covers(windows: TimedItem[], target: TimedItem): boolean {
  let reached = target.startsAt.getTime();
  const sorted = [...windows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (const w of sorted) {
    if (w.startsAt.getTime() > reached) break;
    reached = Math.max(reached, w.endsAt.getTime());
    if (reached >= target.endsAt.getTime()) return true;
  }
  return reached >= target.endsAt.getTime();
}

export function shiftAvailabilityConflict(
  shift: TimedItem,
  rows: AvailabilityRowLike[]
): ShiftAvailabilityConflict | null {
  const touching = rows.filter((r) => overlaps(r, shift));
  if (touching.some((r) => r.status === "UNAVAILABLE")) return "UNAVAILABLE";

  const shiftDays: TimedItem = {
    startsAt: hospitalInstant(hospitalDate(shift.startsAt), 0),
    endsAt: hospitalInstant(addDaysToKey(hospitalDate(new Date(shift.endsAt.getTime() - 1)), 1), 0),
  };
  const declared = rows.some((r) => r.status === "AVAILABLE" && overlaps(r, shiftDays));
  if (!declared) return null;

  const available = touching.filter((r) => r.status === "AVAILABLE");
  return covers(available, shift) ? null : "OUTSIDE_AVAILABILITY";
}

export const CONFLICT_LABELS: Record<ShiftAvailabilityConflict, string> = {
  UNAVAILABLE: "You marked yourself not available during this shift",
  OUTSIDE_AVAILABILITY: "This shift falls outside your availability",
};
