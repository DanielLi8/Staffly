import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow } from "date-fns";
import { hospitalCalendarDay, hospitalDate, hospitalDateLong, hospitalDateTime, hospitalTime } from "./timezone";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatShiftDate(date: Date | string): string {
  const d = new Date(date);
  const today = hospitalDate(new Date());
  const tomorrow = hospitalDate(new Date(Date.now() + 86400000));
  const day = hospitalDate(d);
  if (day === today) return `Today, ${hospitalTime(d)}`;
  if (day === tomorrow) return `Tomorrow, ${hospitalTime(d)}`;
  return hospitalDateTime(d).replace(", ", ", ") .replace(" at ", " · ");
}

export function formatShiftRange(start: Date | string, end: Date | string): string {
  return `${hospitalTime(start)} – ${hospitalTime(end)}`;
}

export function formatRelative(date: Date | string): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function formatDate(date: Date | string): string {
  return hospitalDateLong(date);
}

export function formatCalendarDay(date: Date | string): string {
  return hospitalCalendarDay(date);
}

export function formatTimeRange(start: Date | string, end: Date | string): string {
  return `${hospitalTime(start, false)} - ${hospitalTime(end, false)}`;
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
