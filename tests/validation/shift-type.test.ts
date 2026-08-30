import { describe, it, expect } from "vitest";
import { classifyShiftType } from "@/lib/shifts/shift-type";

// All times below are hospital-timezone (America/New_York) wall-clock times,
// expressed here as UTC instants offset by the seasonally-correct UTC offset
// for a fixed date in each season where relevant. To keep this independent of
// DST, we use a date in January (EST, UTC-5) throughout.

function ny(hour: number, minute = 0): Date {
  // 2026-01-15 is EST (UTC-5), so hospital hour = UTC hour - 5.
  const utcHour = (hour + 5) % 24;
  const dayOffset = hour + 5 >= 24 ? 1 : 0;
  return new Date(Date.UTC(2026, 0, 15 + dayOffset, utcHour, minute));
}

describe("classifyShiftType", () => {
  it("classifies 07:00 (start of Day) as DAY", () => {
    expect(classifyShiftType(ny(7, 0))).toBe("DAY");
  });

  it("classifies 14:59 as DAY (just before the Evening boundary)", () => {
    expect(classifyShiftType(ny(14, 59))).toBe("DAY");
  });

  it("classifies 15:00 (start of Evening) as EVENING", () => {
    expect(classifyShiftType(ny(15, 0))).toBe("EVENING");
  });

  it("classifies 22:59 as EVENING (just before the Night boundary)", () => {
    expect(classifyShiftType(ny(22, 59))).toBe("EVENING");
  });

  it("classifies 23:00 (start of Night) as NIGHT", () => {
    expect(classifyShiftType(ny(23, 0))).toBe("NIGHT");
  });

  it("classifies 06:59 as NIGHT (just before the Day boundary)", () => {
    expect(classifyShiftType(ny(6, 59))).toBe("NIGHT");
  });

  it("classifies midnight (00:00) as NIGHT", () => {
    expect(classifyShiftType(ny(0, 0))).toBe("NIGHT");
  });

  it("classifies a 12-hour day shift (07:00-19:00) as DAY, even though it overruns into Evening", () => {
    // Only startsAt matters - endsAt (19:00, inside the Evening window) must
    // not affect the classification.
    const startsAt = ny(7, 0);
    expect(classifyShiftType(startsAt)).toBe("DAY");
  });
});
