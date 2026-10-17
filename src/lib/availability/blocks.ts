import type { AvailabilityStatus } from "@prisma/client";
import { addDaysToKey, hospitalDate, hospitalInstant, hospitalMinutesOfDay } from "@/lib/timezone";
import { MINUTES_PER_DAY, minuteLabel } from "@/lib/schedule/time-grid";

/**
 * The availability editor's vocabulary, kept pure so the client panel, the
 * server action and the tests share one interpretation.
 *
 * A block is a time-of-day range applied to a day: `startMinute` (0-1425) and
 * `endMinute` (15-1440, where 1440 is midnight) in hospital-clock minutes, on
 * a 15-minute grid. `endMinute <= startMinute` means the block runs overnight
 * into the next day ("Nights 19:00-07:00"), which is what a night-shift worker
 * needs: the callout cascade (`src/lib/callout/tiers.ts`) matches by
 * overlapping instants, so a night shift is only covered by a window that
 * actually reaches into the next morning.
 */

export type EditableAvailabilityStatus = Extract<AvailabilityStatus, "AVAILABLE" | "UNAVAILABLE">;

export interface AvailabilityBlock {
  status: EditableAvailabilityStatus;
  startMinute: number;
  endMinute: number;
}

/** A saved Availability row, as the editor and the grid see it. */
export interface AvailabilityRowLike {
  startsAt: Date;
  endsAt: Date;
  status: AvailabilityStatus;
}

export const TIME_STEP_MINUTES = 15;

export type AvailabilityPresetId = "all-day" | "days" | "nights" | "not-available";

export interface AvailabilityPreset {
  id: AvailabilityPresetId;
  label: string;
  detail: string;
  blocks: AvailabilityBlock[];
}

export const AVAILABILITY_PRESETS: AvailabilityPreset[] = [
  { id: "all-day", label: "All day", detail: "Available", blocks: [{ status: "AVAILABLE", startMinute: 0, endMinute: 1440 }] },
  { id: "days", label: "Days", detail: "07:00 – 19:00", blocks: [{ status: "AVAILABLE", startMinute: 420, endMinute: 1140 }] },
  { id: "nights", label: "Nights", detail: "19:00 – 07:00", blocks: [{ status: "AVAILABLE", startMinute: 1140, endMinute: 420 }] },
  {
    id: "not-available",
    label: "Not available",
    detail: "All day",
    blocks: [{ status: "UNAVAILABLE", startMinute: 0, endMinute: 1440 }],
  },
];

export function isOvernight(block: Pick<AvailabilityBlock, "startMinute" | "endMinute">): boolean {
  return block.endMinute <= block.startMinute;
}

export function blockValidationError(block: AvailabilityBlock): string | null {
  const onStep = (m: number) => Number.isInteger(m) && m % TIME_STEP_MINUTES === 0;
  if (!onStep(block.startMinute) || block.startMinute < 0 || block.startMinute >= MINUTES_PER_DAY) {
    return "Pick a start time.";
  }
  if (!onStep(block.endMinute) || block.endMinute <= 0 || block.endMinute > MINUTES_PER_DAY) {
    return "Pick an end time.";
  }
  if (block.startMinute === block.endMinute) return "Start and end can't be the same time.";
  return null;
}

/** `07:00 – 19:00`, with "(next day)" for an overnight block. */
export function blockRangeLabel(block: Pick<AvailabilityBlock, "startMinute" | "endMinute">): string {
  const range = `${minuteLabel(block.startMinute)} – ${minuteLabel(block.endMinute)}`;
  return isOvernight(block) ? `${range} (next day)` : range;
}

export function blockLabel(block: AvailabilityBlock): string {
  if (block.startMinute === 0 && block.endMinute === MINUTES_PER_DAY) {
    return block.status === "AVAILABLE" ? "Available all day" : "Not available all day";
  }
  return `${block.status === "AVAILABLE" ? "Available" : "Not available"} ${blockRangeLabel(block)}`;
}

/** Order-independent identity for a set of blocks ("same availability"). */
export function blocksSignature(blocks: AvailabilityBlock[]): string {
  return blocks
    .map((b) => `${b.status}:${b.startMinute}-${b.endMinute}`)
    .sort()
    .join("|");
}

export function presetForBlocks(blocks: AvailabilityBlock[]): AvailabilityPresetId | null {
  const signature = blocksSignature(blocks);
  return AVAILABILITY_PRESETS.find((p) => blocksSignature(p.blocks) === signature)?.id ?? null;
}

/** The hospital day a saved row belongs to: the one it starts on. */
export function rowDayKey(row: Pick<AvailabilityRowLike, "startsAt">): string {
  return hospitalDate(row.startsAt);
}

export function groupRowsByDay<T extends AvailabilityRowLike>(rows: T[]): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const row of rows) {
    const key = rowDayKey(row);
    const list = byDay.get(key);
    if (list) list.push(row);
    else byDay.set(key, [row]);
  }
  return byDay;
}

function snap(minute: number): number {
  return Math.round(minute / TIME_STEP_MINUTES) * TIME_STEP_MINUTES;
}

/**
 * Turns the saved rows of one day back into editor blocks, so opening the
 * editor shows what is actually saved instead of a default (the old editor
 * showed a hard-coded 7:00 AM-3:00 PM and Submit overwrote the real rows).
 * Returns null when a row can't be expressed as an editable block (a
 * TENTATIVE row, or one longer than a day); callers treat that day as "has
 * availability the presets don't describe".
 */
export function blocksFromRows(dayKey: string, rows: AvailabilityRowLike[]): AvailabilityBlock[] | null {
  const blocks: AvailabilityBlock[] = [];
  const nextMidnight = hospitalInstant(addDaysToKey(dayKey, 1), 0);
  for (const row of rows) {
    if (row.status !== "AVAILABLE" && row.status !== "UNAVAILABLE") return null;
    const startMinute = snap(hospitalMinutesOfDay(row.startsAt));
    if (startMinute >= MINUTES_PER_DAY) return null;
    let endMinute: number;
    if (row.endsAt.getTime() === nextMidnight.getTime()) {
      endMinute = MINUTES_PER_DAY;
    } else if (row.endsAt < nextMidnight) {
      endMinute = snap(hospitalMinutesOfDay(row.endsAt));
      if (endMinute <= startMinute) return null;
    } else {
      // Runs into the next day: representable only while it ends before the
      // same clock time tomorrow.
      if (row.endsAt > hospitalInstant(addDaysToKey(dayKey, 1), startMinute)) return null;
      endMinute = snap(hospitalMinutesOfDay(row.endsAt));
      if (endMinute === 0) endMinute = MINUTES_PER_DAY;
      if (endMinute > startMinute) return null;
    }
    blocks.push({ status: row.status, startMinute, endMinute });
  }
  return blocks.sort((a, b) => a.startMinute - b.startMinute);
}

export type SelectionPattern =
  /** No selected day has anything saved. */
  | { kind: "empty" }
  /** Every selected day has exactly these blocks saved. */
  | { kind: "same"; blocks: AvailabilityBlock[] }
  /** The selected days differ (or some can't be shown as blocks). */
  | { kind: "mixed"; daysWithAvailability: number };

/** What is saved now across the selected days - decides how the editor opens. */
export function selectionPattern(dayKeys: string[], rowsByDay: Map<string, AvailabilityRowLike[]>): SelectionPattern {
  let daysWithAvailability = 0;
  let signature: string | null | undefined;
  let sameBlocks: AvailabilityBlock[] | null = null;
  let mixed = false;

  for (const key of dayKeys) {
    const rows = rowsByDay.get(key) ?? [];
    if (rows.length > 0) daysWithAvailability += 1;
    const blocks = rows.length === 0 ? [] : blocksFromRows(key, rows);
    const sig = blocks === null ? null : blocksSignature(blocks);
    if (signature === undefined) {
      signature = sig;
      sameBlocks = blocks;
    } else if (sig !== signature) {
      mixed = true;
    }
    if (blocks === null) mixed = true;
  }

  if (daysWithAvailability === 0) return { kind: "empty" };
  if (mixed || !sameBlocks) return { kind: "mixed", daysWithAvailability };
  return { kind: "same", blocks: sameBlocks };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDay(dayKey: string): string {
  const [, m, d] = dayKey.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/**
 * Compact label for a set of days, collapsing consecutive runs:
 * `Oct 19–23, Oct 25`. Used in notifications and the saved toast.
 */
export function dayKeysLabel(dayKeys: string[]): string {
  const sorted = Array.from(new Set(dayKeys)).sort();
  const runs: [string, string][] = [];
  for (const key of sorted) {
    const last = runs[runs.length - 1];
    if (last && addDaysToKey(last[1], 1) === key) last[1] = key;
    else runs.push([key, key]);
  }
  return runs
    .map(([from, to]) => {
      if (from === to) return shortDay(from);
      const sameMonth = from.slice(0, 7) === to.slice(0, 7);
      return sameMonth ? `${shortDay(from)}–${Number(to.slice(8))}` : `${shortDay(from)} – ${shortDay(to)}`;
    })
    .join(", ");
}
