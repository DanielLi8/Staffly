import { hospitalDate, hospitalTime } from "@/lib/timezone";

/**
 * Typeable clock-time entry for the shift form. Native `datetime-local` inputs
 * render a scrolling picker that is slow to drive, so the form takes a date
 * field plus a free-text time field and parses it here. Pure + unit-tested so
 * both the client guard and the server action can share one interpretation.
 */

export interface ParsedTime {
  hours: number;
  minutes: number;
}

const TIME_PATTERN = /^(\d{1,2})(?::?(\d{2}))?\s*([ap])\.?m?\.?$|^(\d{1,2})(?::?(\d{2}))?$/i;

/**
 * Accepts `7:00 AM`, `7 pm`, `07:30`, `0730`, `19:00`. Returns null when the
 * text is not a time we can read, so callers can show a field-level message.
 */
export function parseTimeInput(value: string): ParsedTime | null {
  const match = TIME_PATTERN.exec(value.trim().replace(/\s+/g, " "));
  if (!match) return null;

  const meridiem = match[3]?.toLowerCase();
  const rawHours = Number(meridiem ? match[1] : match[4]);
  const rawMinutes = Number((meridiem ? match[2] : match[5]) ?? "0");

  if (!Number.isInteger(rawHours) || !Number.isInteger(rawMinutes)) return null;
  if (rawMinutes > 59) return null;

  if (meridiem) {
    if (rawHours < 1 || rawHours > 12) return null;
    const base = rawHours % 12;
    return { hours: meridiem === "p" ? base + 12 : base, minutes: rawMinutes };
  }

  if (rawHours > 23) return null;
  return { hours: rawHours, minutes: rawMinutes };
}

/** Renders a Date as the AM/PM text the time inputs expect (`7:00 AM`). */
export function formatTimeInput(date: Date): string {
  return hospitalTime(date);
}

/** Renders a Date as the `yyyy-MM-dd` value a native date input expects. */
export function formatDateInput(date: Date): string {
  return hospitalDate(date);
}

/**
 * Combines a `yyyy-MM-dd` date value with typed time text into a local Date.
 * Returns null if either half is unreadable.
 */
export function combineDateAndTime(dateValue: string, timeValue: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue.trim());
  if (!dateMatch) return null;

  const time = parseTimeInput(timeValue);
  if (!time) return null;

  const combined = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    time.hours,
    time.minutes,
    0,
    0
  );
  return Number.isNaN(combined.getTime()) ? null : combined;
}
