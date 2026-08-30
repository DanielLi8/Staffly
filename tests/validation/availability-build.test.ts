import { describe, it, expect } from "vitest";
import { addDays } from "date-fns";
import { AVAILABILITY_MESSAGES, buildAvailabilityRows } from "@/lib/availability/build";

const day1 = new Date(2027, 8, 2);
const day2 = new Date(2027, 8, 4);

describe("buildAvailabilityRows", () => {
  it("rejects an empty day selection", () => {
    const result = buildAvailabilityRows([], "AVAILABLE", { from: "7:00 AM", to: "3:00 PM" });
    expect(result).toEqual({ ok: false, error: AVAILABILITY_MESSAGES.noDaysSelected });
  });

  it("builds one full-day UNAVAILABLE row per selected day, no time needed", () => {
    const result = buildAvailabilityRows([day1, day2], "UNAVAILABLE");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].status).toBe("UNAVAILABLE");
    expect(result.rows[0].startsAt).toEqual(day1);
    expect(result.rows[0].endsAt).toEqual(addDays(day1, 1));
  });

  it("applies one shared time range to every selected AVAILABLE day", () => {
    const result = buildAvailabilityRows([day1, day2], "AVAILABLE", { from: "7:00 AM", to: "3:00 PM" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    for (const row of result.rows) {
      expect(row.status).toBe("AVAILABLE");
      expect(row.startsAt.getHours()).toBe(7);
      expect(row.endsAt.getHours()).toBe(15);
    }
  });

  it("requires a time range for AVAILABLE", () => {
    const result = buildAvailabilityRows([day1], "AVAILABLE");
    expect(result).toEqual({ ok: false, error: AVAILABILITY_MESSAGES.timeRequired });
  });

  it("rejects an unreadable from/to time", () => {
    expect(buildAvailabilityRows([day1], "AVAILABLE", { from: "not a time", to: "3:00 PM" })).toEqual({
      ok: false,
      error: AVAILABILITY_MESSAGES.invalidFrom,
    });
    expect(buildAvailabilityRows([day1], "AVAILABLE", { from: "7:00 AM", to: "nope" })).toEqual({
      ok: false,
      error: AVAILABILITY_MESSAGES.invalidTo,
    });
  });

  it("rejects an end time at or before the start", () => {
    const result = buildAvailabilityRows([day1], "AVAILABLE", { from: "3:00 PM", to: "3:00 PM" });
    expect(result).toEqual({ ok: false, error: AVAILABILITY_MESSAGES.endBeforeStart });
  });
});
