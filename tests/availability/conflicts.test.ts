import { describe, it, expect } from "vitest";
import { hospitalInstant } from "@/lib/timezone";
import { shiftAvailabilityConflict } from "@/lib/availability/conflicts";

function span(day: string, start: number, end: number) {
  return { startsAt: hospitalInstant(day, start), endsAt: hospitalInstant(day, end) };
}

const dayShift = span("2026-10-19", 420, 1140);

describe("shiftAvailabilityConflict", () => {
  it("is null when nothing is declared (not set is not a conflict)", () => {
    expect(shiftAvailabilityConflict(dayShift, [])).toBeNull();
  });

  it("is null when an Available window covers the shift", () => {
    expect(shiftAvailabilityConflict(dayShift, [{ ...span("2026-10-19", 360, 1200), status: "AVAILABLE" }])).toBeNull();
  });

  it("flags a shift running past the declared window", () => {
    expect(shiftAvailabilityConflict(dayShift, [{ ...span("2026-10-19", 360, 1080), status: "AVAILABLE" }])).toBe(
      "OUTSIDE_AVAILABILITY"
    );
  });

  it("flags any overlap with Not available, even inside Available time", () => {
    expect(
      shiftAvailabilityConflict(dayShift, [
        { ...span("2026-10-19", 0, 1440), status: "AVAILABLE" },
        { ...span("2026-10-19", 720, 780), status: "UNAVAILABLE" },
      ])
    ).toBe("UNAVAILABLE");
  });

  it("checks a night shift against both days it touches", () => {
    const night = span("2026-10-22", 1140, 1440 + 420);
    expect(shiftAvailabilityConflict(night, [{ ...span("2026-10-22", 1140, 1440 + 420), status: "AVAILABLE" }])).toBeNull();
    expect(shiftAvailabilityConflict(night, [{ ...span("2026-10-22", 720, 1440), status: "AVAILABLE" }])).toBe(
      "OUTSIDE_AVAILABILITY"
    );
    // Two windows meeting at midnight still cover it.
    expect(
      shiftAvailabilityConflict(night, [
        { ...span("2026-10-22", 720, 1440), status: "AVAILABLE" },
        { ...span("2026-10-23", 0, 600), status: "AVAILABLE" },
      ])
    ).toBeNull();
  });
});
