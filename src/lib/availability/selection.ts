import { addDaysToKey, dayKeyToLocalDate, dayKeysBetween } from "@/lib/timezone";
import { MAX_AVAILABILITY_DAYS } from "./build";

/**
 * Which days the availability editor will change: a contiguous range
 * (`from`-`to`, one day, a week, or any date range) minus the days the worker
 * ticked off ("Oct 19-25, but not Saturday"). Pure so the editor and the tests
 * agree on exactly which days a save touches.
 */
export interface DaySelection {
  from: string;
  to: string;
  excluded: ReadonlySet<string>;
}

export type QuickPick = "every-day" | "weekdays" | "weekends";

export function selectionOf(from: string, to: string): DaySelection {
  return { from, to, excluded: new Set() };
}

export function selectedDayKeys(selection: DaySelection): string[] {
  return dayKeysBetween(selection.from, selection.to).filter((k) => !selection.excluded.has(k));
}

function isWeekend(dayKey: string): boolean {
  const day = dayKeyToLocalDate(dayKey).getDay();
  return day === 0 || day === 6;
}

/** Monday-Sunday week containing `dayKey`. */
export function weekOf(dayKey: string): DaySelection {
  const offset = (dayKeyToLocalDate(dayKey).getDay() + 6) % 7;
  const from = addDaysToKey(dayKey, -offset);
  return selectionOf(from, addDaysToKey(from, 6));
}

/**
 * Tap a day. Inside the range it flips that one day on/off. Outside, the
 * range grows to reach it, and only the tapped day is switched on - the days
 * skipped over in between stay off, so a tap never silently adds days.
 */
export function toggleDay(selection: DaySelection, dayKey: string): DaySelection {
  const excluded = new Set(selection.excluded);
  if (dayKey >= selection.from && dayKey <= selection.to) {
    if (excluded.has(dayKey)) excluded.delete(dayKey);
    else excluded.add(dayKey);
    return { ...selection, excluded };
  }
  const from = dayKey < selection.from ? dayKey : selection.from;
  const to = dayKey > selection.to ? dayKey : selection.to;
  for (const key of dayKeysBetween(from, to)) {
    if (key !== dayKey && (key < selection.from || key > selection.to)) excluded.add(key);
  }
  return { from, to, excluded };
}

/** A dragged run of days: grow the range to cover it and switch all of them on. */
export function addDays(selection: DaySelection, dayKeys: string[]): DaySelection {
  if (dayKeys.length === 0) return selection;
  const sorted = [...dayKeys].sort();
  const from = sorted[0] < selection.from ? sorted[0] : selection.from;
  const to = sorted[sorted.length - 1] > selection.to ? sorted[sorted.length - 1] : selection.to;
  const excluded = new Set(selection.excluded);
  for (const key of dayKeysBetween(from, to)) {
    if (key < selection.from || key > selection.to) excluded.add(key);
  }
  for (const key of sorted) excluded.delete(key);
  return { from, to, excluded };
}

export function applyQuickPick(selection: DaySelection, pick: QuickPick): DaySelection {
  const excluded = new Set<string>();
  for (const key of dayKeysBetween(selection.from, selection.to)) {
    if (pick === "weekdays" && isWeekend(key)) excluded.add(key);
    if (pick === "weekends" && !isWeekend(key)) excluded.add(key);
  }
  return { ...selection, excluded };
}

/** Keeps a typed date range within what one save may touch. */
export function clampRange(from: string, to: string): { from: string; to: string; clamped: boolean } {
  const last = addDaysToKey(from, MAX_AVAILABILITY_DAYS - 1);
  return to > last ? { from, to: last, clamped: true } : { from, to, clamped: false };
}
