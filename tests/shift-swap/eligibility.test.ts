import { describe, it, expect } from "vitest";
import {
  MAX_CONSECUTIVE_SHIFT_DAYS,
  MAX_PAY_PERIOD_HOURS,
  SWAP_ELIGIBILITY_MESSAGES,
  evaluateReceivingEligibility,
  type EligibilityShift,
} from "@/lib/shift-swap/eligibility";

/** An 8h shift on the given hospital-local calendar date (America/New_York, EDT in August). */
function shift(id: string, isoDate: string, startHour = 7): EligibilityShift {
  const startsAt = new Date(`${isoDate}T${String(startHour).padStart(2, "0")}:00:00-04:00`);
  return { id, startsAt, endsAt: new Date(startsAt.getTime() + 8 * 3_600_000) };
}

describe("evaluateReceivingEligibility - pay period hours", () => {
  it("is eligible when total pay-period hours stay at or under 75", () => {
    // 8 existing 8h shifts (64h) + one more 8h shift = 72h, within the anchor
    // pay period (Aug 23 - Sep 5).
    const existing = [
      shift("e1", "2026-08-24"),
      shift("e2", "2026-08-25"),
      shift("e3", "2026-08-27"),
      shift("e4", "2026-08-28"),
      shift("e5", "2026-08-31"),
      shift("e6", "2026-09-01"),
      shift("e7", "2026-09-03"),
      shift("e8", "2026-09-04"),
    ];
    const result = evaluateReceivingEligibility(shift("new", "2026-08-30"), existing);
    expect(result.eligible).toBe(true);
  });

  it("blocks when the pay-period total would exceed 75 hours", () => {
    // 9 existing 8h shifts (72h) + one more 8h shift = 80h > 75h.
    const existing = [
      shift("e1", "2026-08-23"),
      shift("e2", "2026-08-24"),
      shift("e3", "2026-08-26"),
      shift("e4", "2026-08-27"),
      shift("e5", "2026-08-29"),
      shift("e6", "2026-08-31"),
      shift("e7", "2026-09-02"),
      shift("e8", "2026-09-03"),
      shift("e9", "2026-09-05"),
    ];
    const result = evaluateReceivingEligibility(shift("new", "2026-08-25"), existing);
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toBe("EXCEEDS_PAY_PERIOD_HOURS");
      expect(result.message).toBe(SWAP_ELIGIBILITY_MESSAGES.EXCEEDS_PAY_PERIOD_HOURS);
    }
  });

  it("does not treat exactly 75 hours as a violation (strictly greater than)", () => {
    // 8 existing 8h shifts (64h) + a 3h partial shift + the new 8h shift =
    // exactly 75h.
    const existingFull = [
      shift("e1", "2026-08-24"),
      shift("e2", "2026-08-25"),
      shift("e3", "2026-08-27"),
      shift("e4", "2026-08-28"),
      shift("e5", "2026-08-31"),
      shift("e6", "2026-09-01"),
      shift("e7", "2026-09-03"),
      shift("e8", "2026-09-04"),
    ];
    const partial: EligibilityShift = {
      id: "partial",
      startsAt: new Date("2026-08-26T07:00:00-04:00"),
      endsAt: new Date("2026-08-26T10:00:00-04:00"),
    };
    const result = evaluateReceivingEligibility(shift("new", "2026-08-30"), [...existingFull, partial]);
    expect(result.eligible).toBe(true);
  });

  it("ignores shifts outside the target pay period entirely", () => {
    // 9 existing 8h shifts (72h) all in the PREVIOUS pay period - should not
    // count toward the target shift's own period at all.
    const existing = Array.from({ length: 9 }, (_, i) => shift(`prev${i}`, "2026-08-10"));
    const result = evaluateReceivingEligibility(shift("new", "2026-08-24"), existing);
    expect(result.eligible).toBe(true);
  });

  it("excludes a shift sharing the new shift's id from the total (no double count)", () => {
    const target = shift("dup", "2026-08-24");
    const result = evaluateReceivingEligibility(target, [target]);
    expect(result.eligible).toBe(true);
  });
});

describe("evaluateReceivingEligibility - consecutive shifts", () => {
  it("is eligible with fewer than 7 consecutive calendar days", () => {
    const existing = [
      shift("e1", "2026-08-24"),
      shift("e2", "2026-08-25"),
      shift("e3", "2026-08-26"),
      shift("e4", "2026-08-27"),
      shift("e5", "2026-08-28"),
    ];
    // Adding Aug 29 makes 6 consecutive days (24-29), still under 7.
    const result = evaluateReceivingEligibility(shift("new", "2026-08-29"), existing);
    expect(result.eligible).toBe(true);
  });

  it("blocks when picking up the shift creates exactly 7 consecutive calendar days", () => {
    const existing = [
      shift("e1", "2026-08-24"),
      shift("e2", "2026-08-25"),
      shift("e3", "2026-08-26"),
      shift("e4", "2026-08-27"),
      shift("e5", "2026-08-28"),
      shift("e6", "2026-08-29"),
    ];
    // Adding Aug 30 makes 7 consecutive days (24-30).
    const result = evaluateReceivingEligibility(shift("new", "2026-08-30"), existing);
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toBe("EXCEEDS_CONSECUTIVE_SHIFTS");
      expect(result.message).toBe(SWAP_ELIGIBILITY_MESSAGES.EXCEEDS_CONSECUTIVE_SHIFTS);
    }
  });

  it("counts a streak that spans a gap on both sides of the new shift", () => {
    const existing = [
      shift("before1", "2026-08-26"),
      shift("before2", "2026-08-27"),
      shift("before3", "2026-08-28"),
      shift("after1", "2026-08-30"),
      shift("after2", "2026-08-31"),
      shift("after3", "2026-09-01"),
    ];
    // New shift on Aug 29 bridges the two runs into one streak of 7 (26-Sep 1).
    const result = evaluateReceivingEligibility(shift("new", "2026-08-29"), existing);
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe("EXCEEDS_CONSECUTIVE_SHIFTS");
  });

  it("does not treat a day-apart shift as consecutive", () => {
    const existing = [
      shift("e1", "2026-08-20"),
      shift("e2", "2026-08-22"),
      shift("e3", "2026-08-24"),
      shift("e4", "2026-08-26"),
      shift("e5", "2026-08-28"),
      shift("e6", "2026-08-30"),
    ];
    const result = evaluateReceivingEligibility(shift("new", "2026-09-01"), existing);
    expect(result.eligible).toBe(true);
  });

  it("counts an overnight shift under the calendar day its start falls on", () => {
    // A night shift starting 23:00 and a day shift starting 07:00 the next
    // calendar day both count on their own start day - back-to-back overnight
    // shifts across a boundary are two separate consecutive days here, by the
    // stated calendar-day-adjacency definition, not a single merged block.
    const existing = [
      shift("d1", "2026-08-24"),
      shift("d2", "2026-08-25"),
      shift("d3", "2026-08-26"),
      shift("d4", "2026-08-27"),
      shift("d5", "2026-08-28"),
      shift("night", "2026-08-29", 23),
    ];
    const result = evaluateReceivingEligibility(shift("new", "2026-08-30"), existing);
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe("EXCEEDS_CONSECUTIVE_SHIFTS");
  });
});

describe("constants", () => {
  it("matches the mockup's thresholds", () => {
    expect(MAX_PAY_PERIOD_HOURS).toBe(75);
    expect(MAX_CONSECUTIVE_SHIFT_DAYS).toBe(7);
  });
});
