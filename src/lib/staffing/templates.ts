import type { ShiftPattern } from "@prisma/client";

/**
 * Shift definitions ("templates") per department. PURE: no DB.
 *
 * Captain decision shift-hours-default: shifts default to 8 h (Day 07-15,
 * Evening 15-23, Night 23-07) and a department can switch to 12 h (Day 07-19,
 * Night 19-07). Every department keeps BOTH sets, so a 12 h shift can still be
 * entered in an 8 h unit; `Department.shiftPattern` only picks the set its
 * staffing targets (and the coverage report) are counted against.
 *
 * Minutes are hospital-clock minutes since midnight on a 15-minute grid, the
 * same convention as availability blocks; `endMinute <= startMinute` means the
 * shift ends the next morning.
 */

export const MINUTES_PER_DAY = 1440;
export const TEMPLATE_MINUTE_STEP = 15;

export const SHIFT_PATTERNS: readonly ShiftPattern[] = ["EIGHT_HOUR", "TWELVE_HOUR"];

export const SHIFT_PATTERN_LABEL: Record<ShiftPattern, string> = {
  EIGHT_HOUR: "8-hour shifts",
  TWELVE_HOUR: "12-hour shifts",
};

export interface TemplatePreset {
  pattern: ShiftPattern;
  code: string;
  label: string;
  startMinute: number;
  endMinute: number;
  sortOrder: number;
}

/**
 * The default templates every department gets. Mirrored by the SQL backfill in
 * `prisma/migrations/20261026000000_add_shift_templates_staffing_targets`;
 * the seed upserts from this list.
 */
export const TEMPLATE_PRESETS: readonly TemplatePreset[] = [
  { pattern: "EIGHT_HOUR", code: "D", label: "Day", startMinute: 7 * 60, endMinute: 15 * 60, sortOrder: 0 },
  { pattern: "EIGHT_HOUR", code: "E", label: "Evening", startMinute: 15 * 60, endMinute: 23 * 60, sortOrder: 1 },
  { pattern: "EIGHT_HOUR", code: "N", label: "Night", startMinute: 23 * 60, endMinute: 7 * 60, sortOrder: 2 },
  { pattern: "TWELVE_HOUR", code: "D12", label: "Day", startMinute: 7 * 60, endMinute: 19 * 60, sortOrder: 0 },
  { pattern: "TWELVE_HOUR", code: "N12", label: "Night", startMinute: 19 * 60, endMinute: 7 * 60, sortOrder: 1 },
];

export interface TemplateLike {
  id: string;
  pattern: ShiftPattern;
  code: string;
  label: string;
  startMinute: number;
  endMinute: number;
  sortOrder: number;
}

/** The templates a department's targets are counted against, in display order. */
export function activeTemplates<T extends TemplateLike>(templates: readonly T[], pattern: ShiftPattern): T[] {
  return templates.filter((t) => t.pattern === pattern).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Wall-clock length in minutes (the DST night's real length is a materialization concern). */
export function templateDurationMinutes(startMinute: number, endMinute: number): number {
  return endMinute > startMinute ? endMinute - startMinute : MINUTES_PER_DAY - startMinute + endMinute;
}

export function endsNextDay(startMinute: number, endMinute: number): boolean {
  return endMinute <= startMinute;
}

/** `420` -> `"07:00"`. Hospital shift times are always shown on the 24 h clock. */
export function formatClockMinute(minute: number): string {
  const m = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** `"07:00-15:00"`. */
export function formatTemplateRange(t: { startMinute: number; endMinute: number }): string {
  return `${formatClockMinute(t.startMinute)}-${formatClockMinute(t.endMinute)}`;
}

/** `480` -> `"8 h"`, `450` -> `"7.5 h"`. */
export function formatDurationHours(minutes: number): string {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(2).replace(/0+$/, "")} h`;
}

/** Every selectable start/end minute: 00:00, 00:15, ... 23:45. */
export const TEMPLATE_MINUTE_OPTIONS: readonly number[] = Array.from(
  { length: MINUTES_PER_DAY / TEMPLATE_MINUTE_STEP },
  (_, i) => i * TEMPLATE_MINUTE_STEP
);

export type TemplateTimesError = "OFF_GRID" | "ZERO_LENGTH";

export const TEMPLATE_TIMES_MESSAGE: Record<TemplateTimesError, string> = {
  OFF_GRID: "Shift times must be on the quarter hour (00, 15, 30 or 45).",
  ZERO_LENGTH: "A shift can't start and end at the same time.",
};

/** Shared by the editor (to block a bad save) and the server action. */
export function validateTemplateTimes(startMinute: number, endMinute: number): TemplateTimesError | null {
  const onGrid = (m: number) =>
    Number.isInteger(m) && m >= 0 && m < MINUTES_PER_DAY && m % TEMPLATE_MINUTE_STEP === 0;
  if (!onGrid(startMinute) || !onGrid(endMinute)) return "OFF_GRID";
  if (startMinute === endMinute) return "ZERO_LENGTH";
  return null;
}

/** "Day", or "Day (12 h)" for the 12-hour set, so history entries stay unambiguous. */
export function templateDisplayName(t: { label: string; pattern: ShiftPattern }): string {
  return t.pattern === "TWELVE_HOUR" ? `${t.label} (12 h)` : t.label;
}
