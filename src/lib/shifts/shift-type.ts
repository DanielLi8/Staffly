import { HOSPITAL_TIME_ZONE } from "@/lib/timezone";

export type ShiftType = "DAY" | "EVENING" | "NIGHT";

/**
 * Classifies a shift by the hospital-timezone clock hour of `startsAt` ONLY,
 * not the full shift span - a 12-hour day shift starting 07:00 still
 * classifies as DAY even though it overruns into the Evening window.
 *
 * 07:00-15:00 = DAY, 15:00-23:00 = EVENING, 23:00-07:00 = NIGHT.
 */
export function classifyShiftType(startsAt: Date): ShiftType {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: HOSPITAL_TIME_ZONE,
      hour: "numeric",
      hour12: false,
    }).format(startsAt)
  ) % 24;

  if (hour >= 7 && hour < 15) return "DAY";
  if (hour >= 15 && hour < 23) return "EVENING";
  return "NIGHT";
}
