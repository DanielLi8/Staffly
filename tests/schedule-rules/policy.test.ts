import { describe, it, expect } from "vitest";
import {
  DEFAULT_MIN_REST_HOURS,
  DOUBLE_MAX_GAP_MINUTES,
  MAX_CONSECUTIVE_DAYS,
  PAY_PERIOD_OVERTIME_HOURS,
  SCHEDULE_POLICY,
  schedulePolicyFor,
} from "@/lib/schedule-rules/policy";

describe("SCHEDULE_POLICY", () => {
  it("encodes the captain's numbers", () => {
    expect(PAY_PERIOD_OVERTIME_HOURS).toBe(75);
    expect(MAX_CONSECUTIVE_DAYS).toBe(7);
    expect(DOUBLE_MAX_GAP_MINUTES).toBe(60);
    // Provisional until the union-contract number arrives.
    expect(DEFAULT_MIN_REST_HOURS).toBe(12);
    expect(SCHEDULE_POLICY.minRestHours).toBe(DEFAULT_MIN_REST_HOURS);
  });
});

describe("schedulePolicyFor", () => {
  it("uses the hospital's minRestHours setting", () => {
    expect(schedulePolicyFor({ minRestHours: 8 })).toEqual({ ...SCHEDULE_POLICY, minRestHours: 8 });
    expect(schedulePolicyFor({ minRestHours: 0 }).minRestHours).toBe(0);
  });

  it.each([null, undefined])("falls back to the default when the hospital (%s) has no setting", (hospital) => {
    expect(schedulePolicyFor(hospital)).toEqual(SCHEDULE_POLICY);
    expect(schedulePolicyFor({ minRestHours: null })).toEqual(SCHEDULE_POLICY);
  });

  it.each([-1, 25, Number.NaN])("ignores an out-of-range setting (%s)", (minRestHours) => {
    expect(schedulePolicyFor({ minRestHours }).minRestHours).toBe(DEFAULT_MIN_REST_HOURS);
  });

  it("never lets a hospital change the overtime line", () => {
    expect(schedulePolicyFor({ minRestHours: 8 }).payPeriodOvertimeHours).toBe(75);
  });
});
