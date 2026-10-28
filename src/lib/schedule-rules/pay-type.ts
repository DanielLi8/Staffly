/**
 * Straight time vs overtime for one more shift (decision `overtime-line`):
 * a shift is overtime when it takes the person to 75 h or more in the 14-day
 * pay period, or when it is a back-to-back double with another of their
 * shifts. PURE: no DB, no clock.
 */
import { describeShift, formatHours } from "./describe";
import { payPeriodHours, windowHours } from "./hours";
import { payPeriodFor, payPeriodLabel } from "./pay-period";
import type { SchedulePolicy } from "./policy";
import type { PayTypeClassification, ScheduleShift } from "./types";

const MS_PER_HOUR = 3_600_000;

export interface RestNeighbor {
  shift: ScheduleShift;
  /** Hours between the two shifts (end to start). */
  gapHours: number;
  /** Within `doubleMaxGapMinutes`: a back-to-back double. */
  isDouble: boolean;
}

/**
 * The person's shifts that count against `shift`: not the shift itself (by
 * id) and never a cancelled one.
 */
export function otherShifts(shift: ScheduleShift, shifts: ScheduleShift[]): ScheduleShift[] {
  return shifts.filter((s) => s.status !== "CANCELLED" && !(shift.id && s.id === shift.id));
}

/** Half-open intervals: a shift ending 15:00 does not overlap one starting 15:00. */
export function shiftsOverlap(a: ScheduleShift, b: ScheduleShift): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/**
 * The nearest non-overlapping shift ending at or before `shift` starts
 * (`before`) and starting at or after it ends (`after`), with the rest gap to
 * each. Overlapping shifts are the OVERLAP rule's business, not rest.
 */
export function restNeighbors(
  shift: ScheduleShift,
  others: ScheduleShift[],
  policy: SchedulePolicy
): { before: RestNeighbor | null; after: RestNeighbor | null } {
  const neighbor = (other: ScheduleShift, gapMs: number): RestNeighbor => ({
    shift: other,
    gapHours: gapMs / MS_PER_HOUR,
    isDouble: gapMs <= policy.doubleMaxGapMinutes * 60_000,
  });

  let before: RestNeighbor | null = null;
  let after: RestNeighbor | null = null;
  for (const other of others) {
    const gapBefore = shift.startsAt.getTime() - other.endsAt.getTime();
    if (gapBefore >= 0 && (!before || gapBefore / MS_PER_HOUR < before.gapHours)) before = neighbor(other, gapBefore);
    const gapAfter = other.startsAt.getTime() - shift.endsAt.getTime();
    if (gapAfter >= 0 && (!after || gapAfter / MS_PER_HOUR < after.gapHours)) after = neighbor(other, gapAfter);
  }
  return { before, after };
}

export function doubleReason(side: "before" | "after", neighbor: RestNeighbor): string {
  return `back-to-back double ${side === "before" ? "after" : "before"} ${describeShift(neighbor.shift)}`;
}

/**
 * Classify `shift` for a person who already holds `personShifts` (every
 * department; the shift itself and cancelled shifts are ignored).
 */
export function classifyPayType(
  shift: ScheduleShift,
  personShifts: ScheduleShift[],
  policy: SchedulePolicy
): PayTypeClassification {
  const others = otherShifts(shift, personShifts);
  const shiftHours = windowHours(shift);
  const line = policy.payPeriodOvertimeHours;
  const hoursBefore = payPeriodHours(others, shift.startsAt);
  const hoursAfter = hoursBefore + shiftHours;
  const period = payPeriodLabel(payPeriodFor(shift.startsAt));

  const reasons: string[] = [];
  let overtimeHours = 0;

  if (hoursBefore >= line) {
    reasons.push(
      `already at ${formatHours(hoursBefore)} h of ${line} h, so all ${formatHours(shiftHours)} h are overtime - pay period ${period}`
    );
    overtimeHours = shiftHours;
  } else if (hoursAfter >= line) {
    reasons.push(`would reach ${formatHours(hoursAfter)} h of ${line} h - pay period ${period}`);
    overtimeHours = hoursAfter - line;
  }

  const { before, after } = restNeighbors(shift, others, policy);
  for (const [side, neighbor] of [["before", before], ["after", after]] as const) {
    if (neighbor?.isDouble) {
      reasons.push(doubleReason(side, neighbor));
      overtimeHours = shiftHours;
    }
  }

  const payPeriod = { label: period, hoursBefore, hoursAfter, overtimeLine: line };
  if (reasons.length === 0) {
    return {
      payType: "STRAIGHT",
      label: "Straight time",
      overtimeHours: 0,
      reasons: [`${formatHours(hoursBefore)} → ${formatHours(hoursAfter)} h of ${line} h - pay period ${period}`],
      payPeriod,
    };
  }
  return { payType: "OVERTIME", label: "Overtime", overtimeHours, reasons, payPeriod };
}
