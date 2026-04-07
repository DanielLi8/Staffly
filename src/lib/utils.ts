import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow, isToday, isTomorrow } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatShiftDate(date: Date | string): string {
  const d = new Date(date);
  if (isToday(d)) return `Today, ${format(d, "h:mm a")}`;
  if (isTomorrow(d)) return `Tomorrow, ${format(d, "h:mm a")}`;
  return format(d, "EEE, MMM d · h:mm a");
}

export function formatShiftRange(start: Date | string, end: Date | string): string {
  return `${format(new Date(start), "h:mm a")} – ${format(new Date(end), "h:mm a")}`;
}

export function formatRelative(date: Date | string): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function formatDate(date: Date | string): string {
  return format(new Date(date), "MMM d, yyyy");
}

export function formatCalendarDay(date: Date | string): string {
  return format(new Date(date), "EEEE, MMMM d");
}

export function formatTimeRange(start: Date | string, end: Date | string): string {
  return `${format(new Date(start), "HH:mm")} - ${format(new Date(end), "HH:mm")}`;
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
