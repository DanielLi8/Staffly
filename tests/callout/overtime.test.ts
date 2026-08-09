import { describe, it, expect } from "vitest";
import {
  DEFAULT_WEEKLY_OT_THRESHOLD_HOURS,
  projectOvertime,
  windowHours,
  workWeekBounds,
} from "@/lib/callout/overtime";

/**
 * The OT flag on the bidder list. Pure, so under/at/over threshold and the
 * same-week filter are all checked directly.
 *
 * Fixture week: Sunday 2026-08-09 .. Saturday 2026-08-15. The target shift is an
 * 8h shift on Wednesday 2026-08-12.
 */

const TARGET = {
  id: "target",
  startsAt: new Date("2026-08-12T11:00:00Z"),
  endsAt: new Date("2026-08-12T19:00:00Z"),
};

/** An 8h shift on the given ISO date, inside the fixture week unless stated. */
function shift(id: string, isoDate: string) {
  return {
    id,
    startsAt: new Date(`${isoDate}T11:00:00Z`),
    endsAt: new Date(`${isoDate}T19:00:00Z`),
  };
}

describe("windowHours", () => {
  it("measures a normal shift", () => {
    expect(windowHours(TARGET)).toBe(8);
  });

  it("handles fractional hours", () => {
    expect(
      windowHours({
        startsAt: new Date("2026-08-12T11:00:00Z"),
        endsAt: new Date("2026-08-12T14:30:00Z"),
      })
    ).toBe(3.5);
  });

  it("never returns a negative duration", () => {
    expect(
      windowHours({
        startsAt: new Date("2026-08-12T19:00:00Z"),
        endsAt: new Date("2026-08-12T11:00:00Z"),
      })
    ).toBe(0);
  });
});

describe("workWeekBounds", () => {
  it("uses a Sunday-start week by default", () => {
    const { weekStart, weekEnd } = workWeekBounds(TARGET.startsAt);
    expect(weekStart.getDay()).toBe(0);
    expect(weekEnd.getDay()).toBe(6);
    expect(weekStart <= TARGET.startsAt).toBe(true);
    expect(weekEnd >= TARGET.startsAt).toBe(true);
  });

  it("honours a configured week start", () => {
    const { weekStart } = workWeekBounds(TARGET.startsAt, 1);
    expect(weekStart.getDay()).toBe(1);
  });
});

describe("projectOvertime - threshold boundaries", () => {
  it("is not overtime well under the threshold", () => {
    const result = projectOvertime({
      targetShift: TARGET,
      assignedShifts: [shift("a", "2026-08-10"), shift("b", "2026-08-11")],
    });
    expect(result.assignedHours).toBe(16);
    expect(result.projectedHours).toBe(24);
    expect(result.isOvertime).toBe(false);
    expect(result.overtimeHours).toBe(0);
  });

  it("is NOT overtime landing exactly on the threshold", () => {
    // 4 x 8h already assigned + this 8h shift = exactly 40h.
    const result = projectOvertime({
      targetShift: TARGET,
      assignedShifts: [
        shift("a", "2026-08-09"),
        shift("b", "2026-08-10"),
        shift("c", "2026-08-11"),
        shift("d", "2026-08-13"),
      ],
    });
    expect(result.projectedHours).toBe(DEFAULT_WEEKLY_OT_THRESHOLD_HOURS);
    expect(result.isOvertime).toBe(false);
    expect(result.overtimeHours).toBe(0);
  });

  it("is overtime one step over the threshold, and reports the excess", () => {
    const result = projectOvertime({
      targetShift: TARGET,
      assignedShifts: [
        shift("a", "2026-08-09"),
        shift("b", "2026-08-10"),
        shift("c", "2026-08-11"),
        shift("d", "2026-08-13"),
        shift("e", "2026-08-14"),
      ],
    });
    expect(result.assignedHours).toBe(40);
    expect(result.projectedHours).toBe(48);
    expect(result.isOvertime).toBe(true);
    expect(result.overtimeHours).toBe(8);
  });

  it("respects a configured threshold", () => {
    const result = projectOvertime({
      targetShift: TARGET,
      assignedShifts: [shift("a", "2026-08-10")],
      thresholdHours: 12,
    });
    expect(result.thresholdHours).toBe(12);
    expect(result.projectedHours).toBe(16);
    expect(result.isOvertime).toBe(true);
    expect(result.overtimeHours).toBe(4);
  });
});

describe("projectOvertime - only same-week assigned shifts count", () => {
  it("ignores shifts in the previous and following weeks", () => {
    const result = projectOvertime({
      targetShift: TARGET,
      assignedShifts: [
        shift("prev-week-1", "2026-08-07"), // Friday of the week before
        shift("prev-week-2", "2026-08-08"), // Saturday of the week before
        shift("in-week", "2026-08-10"),
        shift("next-week-1", "2026-08-16"), // Sunday of the week after
        shift("next-week-2", "2026-08-18"),
      ],
    });
    // Only "in-week" is counted.
    expect(result.assignedHours).toBe(8);
    expect(result.projectedHours).toBe(16);
    expect(result.isOvertime).toBe(false);
  });

  it("counts a shift on the first and last day of the same week", () => {
    const result = projectOvertime({
      targetShift: TARGET,
      assignedShifts: [shift("sunday", "2026-08-09"), shift("saturday", "2026-08-15")],
    });
    expect(result.assignedHours).toBe(16);
  });

  it("never double counts the target shift if it appears in the assigned list", () => {
    const result = projectOvertime({
      targetShift: TARGET,
      assignedShifts: [TARGET, shift("other", "2026-08-10")],
    });
    expect(result.assignedHours).toBe(8);
    expect(result.projectedHours).toBe(16);
  });

  it("reports zero assigned hours for a bidder with nothing else booked", () => {
    const result = projectOvertime({ targetShift: TARGET, assignedShifts: [] });
    expect(result.assignedHours).toBe(0);
    expect(result.projectedHours).toBe(8);
    expect(result.isOvertime).toBe(false);
  });
});
