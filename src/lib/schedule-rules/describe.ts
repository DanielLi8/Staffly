/**
 * Human-readable shift and hours wording for rule messages. PURE; every time
 * is read on the hospital clock.
 */
import { classifyShiftType, type ShiftType } from "@/lib/shifts/shift-type";
import { hospitalMinutesOfDay, hospitalMonthDay, hospitalWeekday } from "@/lib/timezone";
import type { HoursWindow } from "./hours";

const SHIFT_TYPE_LABELS: Record<ShiftType, string> = { DAY: "Day", EVENING: "Evening", NIGHT: "Night" };

function clock(minutes: number, wholeHours: boolean): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  return wholeHours ? hh : `${hh}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "Day 07-15", or "Evening 15:30-23:30" when a time is off the hour. */
export function shiftTimeLabel(shift: HoursWindow): string {
  const start = hospitalMinutesOfDay(shift.startsAt);
  const end = hospitalMinutesOfDay(shift.endsAt);
  const wholeHours = start % 60 === 0 && end % 60 === 0;
  return `${SHIFT_TYPE_LABELS[classifyShiftType(shift.startsAt)]} ${clock(start, wholeHours)}-${clock(end, wholeHours)}`;
}

/** "Day 07-15 Mon Oct 26", plus " (Surgery)" when the department is named. */
export function describeShift(shift: HoursWindow & { departmentName?: string | null }): string {
  const when = `${shiftTimeLabel(shift)} ${hospitalWeekday(shift.startsAt)} ${hospitalMonthDay(shift.startsAt)}`;
  return shift.departmentName ? `${when} (${shift.departmentName})` : when;
}

/** 80 -> "80", 8.5 -> "8.5", 7.6666 -> "7.67". */
export function formatHours(hours: number): string {
  return String(Math.round(hours * 100) / 100);
}
