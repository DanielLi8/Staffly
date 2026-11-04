import { addDaysToKey, hospitalDate, hospitalInstant, HOSPITAL_TIME_ZONE } from "@/lib/timezone";

export type ShiftType = "DAY" | "EVENING" | "NIGHT";

/**
 * Classifies a shift by the hospital-timezone clock hour of `startsAt`, not
 * the full shift span - a 12-hour day shift starting 07:00 still classifies
 * as DAY even though it overruns into the Evening window.
 *
 * 07:00-15:00 = DAY, 15:00-23:00 = EVENING, 23:00-07:00 = NIGHT.
 *
 * One exception needs the end: a shift that starts in the Evening window and
 * runs through to 07:00 the next morning covers the whole night - the 12-hour
 * Nights line, 19:00-07:00 (the availability editor's "Nights" preset) - so it
 * is a NIGHT. Pass `endsAt` wherever the shift's end is known.
 */
export function classifyShiftType(startsAt: Date, endsAt?: Date): ShiftType {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: HOSPITAL_TIME_ZONE,
      hour: "numeric",
      hour12: false,
    }).format(startsAt)
  ) % 24;

  if (hour >= 7 && hour < 15) return "DAY";
  if (hour >= 15 && hour < 23) {
    const nextMorning = hospitalInstant(addDaysToKey(hospitalDate(startsAt), 1), 7 * 60);
    return endsAt && endsAt >= nextMorning ? "NIGHT" : "EVENING";
  }
  return "NIGHT";
}
