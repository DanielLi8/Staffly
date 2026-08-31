import { describe, it, expect } from "vitest";
import { AVAILABILITY_MESSAGES, buildAvailabilityRows } from "@/lib/availability/build";

const day1 = new Date(2027, 8, 2);
const day2 = new Date(2027, 8, 4);

describe("buildAvailabilityRows", () => {
  it("rejects an empty day selection", () => {
    const result = buildAvailabilityRows([], [{ status: "AVAILABLE", from: "7:00 AM", to: "3:00 PM" }]);
    expect(result).toEqual({ ok: false, error: AVAILABILITY_MESSAGES.noDaysSelected });
  });

  it("rejects an empty block list", () => {
    const result = buildAvailabilityRows([day1], []);
    expect(result).toEqual({ ok: false, error: AVAILABILITY_MESSAGES.noBlocks });
  });

  it("builds one row per block per selected day", () => {
    const result = buildAvailabilityRows(
      [day1, day2],
      [
        { status: "AVAILABLE", from: "7:00 AM", to: "12:00 PM" },
        { status: "UNAVAILABLE", from: "12:00 PM", to: "3:00 PM" },
      ]
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(4);
    const day1Rows = result.rows.filter((r) => r.day.getTime() === day1.getTime());
    expect(day1Rows).toHaveLength(2);
    expect(day1Rows[0].status).toBe("AVAILABLE");
    expect(day1Rows[0].startsAt.getHours()).toBe(7);
    expect(day1Rows[0].endsAt.getHours()).toBe(12);
    expect(day1Rows[1].status).toBe("UNAVAILABLE");
    expect(day1Rows[1].startsAt.getHours()).toBe(12);
    expect(day1Rows[1].endsAt.getHours()).toBe(15);
  });

  it("applies every block to every selected day", () => {
    const result = buildAvailabilityRows([day1, day2], [{ status: "AVAILABLE", from: "7:00 AM", to: "3:00 PM" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    for (const row of result.rows) {
      expect(row.status).toBe("AVAILABLE");
      expect(row.startsAt.getHours()).toBe(7);
      expect(row.endsAt.getHours()).toBe(15);
    }
  });

  it("rejects an unreadable from/to time", () => {
    expect(
      buildAvailabilityRows([day1], [{ status: "AVAILABLE", from: "not a time", to: "3:00 PM" }])
    ).toEqual({
      ok: false,
      error: AVAILABILITY_MESSAGES.invalidFrom,
    });
    expect(
      buildAvailabilityRows([day1], [{ status: "AVAILABLE", from: "7:00 AM", to: "nope" }])
    ).toEqual({
      ok: false,
      error: AVAILABILITY_MESSAGES.invalidTo,
    });
  });

  it("rejects an end time at or before the start", () => {
    const result = buildAvailabilityRows([day1], [{ status: "AVAILABLE", from: "3:00 PM", to: "3:00 PM" }]);
    expect(result).toEqual({ ok: false, error: AVAILABILITY_MESSAGES.endBeforeStart });
  });
});
