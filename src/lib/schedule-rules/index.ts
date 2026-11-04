/**
 * The one schedule rule checker: may this person be put on this shift, and is
 * it straight time or overtime? Every path that puts a person on a shift - the
 * planner, awards, bookings from the department view, post-publish overrides,
 * swap approvals - should ask this, so they all agree.
 *
 * PURE: no DB, no clock. The caller loads the person's shifts (every
 * department), availability and approved time off, passes `now`, the context
 * and the hospital's policy (`schedulePolicyFor`), and turns the result into
 * typed server-action failures (never throws; see AGENTS.md "Server-action
 * validation").
 *
 * | Rule                  | PLANNING     | AWARD / POST_PUBLISH_OVERRIDE |
 * |-----------------------|--------------|-------------------------------|
 * | IN_PAST, SHIFT_CLOSED | BLOCK        | BLOCK                         |
 * | ROLE_MISMATCH         | BLOCK        | BLOCK (blank position too)    |
 * | OVERLAP               | BLOCK        | BLOCK                         |
 * | UNAVAILABLE, TIME_OFF | BLOCK        | BLOCK                         |
 * | REST_GAP (short rest or back-to-back double) | BLOCK | NEEDS_REASON  |
 * | PAY_PERIOD_HOURS (reaches 75 h)              | BLOCK | HEADS_UP      |
 * | CONSECUTIVE_DAYS      | NEEDS_REASON | NEEDS_REASON                  |
 * | OUTSIDE_AVAILABILITY  | HEADS_UP     | HEADS_UP                      |
 * | NOT_DEPARTMENT_MEMBER | HEADS_UP     | HEADS_UP                      |
 *
 * PLANNING blocks every kind of overtime and double booking: a schedule is
 * never first posted with overtime in it. In an award or override, overtime
 * is allowed and shows up as the pay type (`payType`), which the confirm must
 * name; a double additionally needs a reason.
 */
import { shiftAvailabilityConflict } from "@/lib/availability/conflicts";
import { positionMatchesRole } from "@/lib/shifts/role-match";
import { describeShift, formatHours } from "./describe";
import { consecutiveDayStreak } from "./hours";
import { classifyPayType, doubleReason, otherShifts, restNeighbors, shiftsOverlap } from "./pay-type";
import { SCHEDULE_POLICY, type SchedulePolicy } from "./policy";
import type {
  AssignmentEvaluation,
  CandidateShift,
  ScheduleContext,
  ScheduleIssue,
  SchedulePerson,
  Severity,
} from "./types";

export * from "./types";
export { classifyPayType } from "./pay-type";
export { SCHEDULE_POLICY, schedulePolicyFor, DEFAULT_MIN_REST_HOURS, type SchedulePolicy } from "./policy";

const SEVERITY_ORDER: Record<Severity, number> = { BLOCK: 0, NEEDS_REASON: 1, HEADS_UP: 2 };

export function evaluateAssignment(input: {
  shift: CandidateShift;
  person: SchedulePerson;
  now: Date;
  context: ScheduleContext;
  policy?: SchedulePolicy;
}): AssignmentEvaluation {
  const { shift, person, now, context } = input;
  const policy = input.policy ?? SCHEDULE_POLICY;
  const planning = context === "PLANNING";
  const others = otherShifts(shift, person.shifts);
  const issues: ScheduleIssue[] = [];

  if (shift.startsAt <= now) {
    issues.push({ rule: "IN_PAST", severity: "BLOCK", message: "This shift has already started" });
  }
  if (shift.status === "CANCELLED" || shift.status === "CLOSED") {
    issues.push({ rule: "SHIFT_CLOSED", severity: "BLOCK", message: `This shift is ${shift.status.toLowerCase()}` });
  }

  if (!positionMatchesRole(person.position, shift.roleNeeded)) {
    issues.push({
      rule: "ROLE_MISMATCH",
      severity: "BLOCK",
      message: person.position?.trim()
        ? `${person.position} doesn't match ${shift.roleNeeded}`
        : `No position recorded, so can't fill ${shift.roleNeeded}`,
    });
  }

  for (const other of others.filter((o) => shiftsOverlap(shift, o))) {
    issues.push({
      rule: "OVERLAP",
      severity: "BLOCK",
      message: `Already on ${describeShift(other)}`,
      relatedShiftId: other.id,
    });
  }

  const availability = shiftAvailabilityConflict(shift, person.availability ?? []);
  if (availability === "UNAVAILABLE") {
    issues.push({ rule: "UNAVAILABLE", severity: "BLOCK", message: "Marked not available during this shift" });
  } else if (availability === "OUTSIDE_AVAILABILITY") {
    issues.push({
      rule: "OUTSIDE_AVAILABILITY",
      severity: "HEADS_UP",
      message: "Declared availability that day doesn't cover this shift",
    });
  }

  if ((person.timeOff ?? []).some((t) => t.status === "APPROVED" && shiftsOverlap(shift, t))) {
    issues.push({ rule: "TIME_OFF", severity: "BLOCK", message: "On approved time off" });
  }

  const restSeverity: Severity = planning ? "BLOCK" : "NEEDS_REASON";
  const { before, after } = restNeighbors(shift, others, policy);
  for (const [side, neighbor] of [["before", before], ["after", after]] as const) {
    if (!neighbor) continue;
    if (neighbor.isDouble) {
      const text = doubleReason(side, neighbor);
      issues.push({
        rule: "REST_GAP",
        severity: restSeverity,
        message: text.charAt(0).toUpperCase() + text.slice(1),
        relatedShiftId: neighbor.shift.id,
      });
    } else if (neighbor.gapHours < policy.minRestHours) {
      issues.push({
        rule: "REST_GAP",
        severity: restSeverity,
        message: `${formatHours(neighbor.gapHours)} h rest ${side === "before" ? "after" : "before"} ${describeShift(
          neighbor.shift
        )} - minimum is ${formatHours(policy.minRestHours)} h`,
        relatedShiftId: neighbor.shift.id,
      });
    }
  }

  const payType = classifyPayType(shift, person.shifts, policy);
  const { hoursAfter, overtimeLine } = payType.payPeriod;
  if (hoursAfter >= overtimeLine) {
    issues.push({ rule: "PAY_PERIOD_HOURS", severity: planning ? "BLOCK" : "HEADS_UP", message: payType.reasons[0] });
  }

  const streak = consecutiveDayStreak(others, shift.startsAt);
  if (streak >= policy.maxConsecutiveDays) {
    issues.push({ rule: "CONSECUTIVE_DAYS", severity: "NEEDS_REASON", message: `Would be ${streak} days in a row` });
  }

  if (person.departmentIds && shift.departmentId && !person.departmentIds.includes(shift.departmentId)) {
    issues.push({ rule: "NOT_DEPARTMENT_MEMBER", severity: "HEADS_UP", message: "Not a member of this department" });
  }

  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return {
    context,
    issues,
    blocked: issues.some((i) => i.severity === "BLOCK"),
    needsReason: issues.some((i) => i.severity === "NEEDS_REASON"),
    payType,
  };
}
