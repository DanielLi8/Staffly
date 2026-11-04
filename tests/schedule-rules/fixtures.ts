import { hospitalInstant } from "@/lib/timezone";
import type { CandidateShift, ScheduleShift } from "@/lib/schedule-rules";

/**
 * Shared fixtures for the rule checker. Times are hospital-clock hours on a
 * hospital day key; an end past 24 runs into the next morning, so a Night is
 * `(day, 23, 31)`. Built through `hospitalInstant`, so the fall-back night
 * (Oct 31 -> Nov 1, 2026) really is 9 h.
 *
 * Calendar: pay periods Oct 18-31 and Nov 1-14, 2026 (Sun-Sat). Oct 19 is a
 * Monday. The checker takes `now` as input, so these fixed dates never go
 * stale.
 */
export const NOW = new Date("2026-10-01T12:00:00Z");

export const DAY = [7, 15] as const;
export const EVENING = [15, 23] as const;
export const NIGHT = [23, 31] as const;

export function shift(
  id: string,
  dayKey: string,
  [startHour, endHour]: readonly [number, number],
  extra: Partial<ScheduleShift> = {}
): ScheduleShift {
  return {
    id,
    startsAt: hospitalInstant(dayKey, Math.round(startHour * 60)),
    endsAt: hospitalInstant(dayKey, Math.round(endHour * 60)),
    ...extra,
  };
}

export function candidate(
  dayKey: string,
  hours: readonly [number, number],
  extra: Partial<CandidateShift> = {}
): CandidateShift {
  return { ...shift("candidate", dayKey, hours), roleNeeded: "Registered Nurse (RN)", departmentId: "med", ...extra };
}

/** 12 h day shifts (07-19) on every other day from Oct 18: 6 of them = 72 h in the Oct 18-31 period. */
export function everyOtherDay12h(count: number): ScheduleShift[] {
  return Array.from({ length: count }, (_, i) =>
    shift(`long-${i}`, `2026-10-${String(18 + 2 * i).padStart(2, "0")}`, [7, 19])
  );
}
