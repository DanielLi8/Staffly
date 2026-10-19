import { describe, it, expect } from "vitest";
import { addDaysToKey, dayKeysBetween, hospitalDate, hospitalInstant, hospitalMinutesOfDay, hospitalTime } from "@/lib/timezone";

// These hold whatever the test runner's own TZ is: every value goes through
// the hospital clock (America/New_York), never the process TZ.
describe("hospital day math", () => {
  it("builds the instant for a hospital wall-clock time (EDT and EST)", () => {
    expect(hospitalInstant("2026-10-19", 7 * 60).toISOString()).toBe("2026-10-19T11:00:00.000Z");
    expect(hospitalInstant("2026-12-01", 7 * 60).toISOString()).toBe("2026-12-01T12:00:00.000Z");
  });

  it("lets minutes run past midnight into the next day", () => {
    expect(hospitalInstant("2026-10-19", 1440 + 7 * 60).toISOString()).toBe("2026-10-20T11:00:00.000Z");
  });

  it("handles the DST change days", () => {
    // Fall back (Nov 1 2026): midnight is still EDT, 07:00 is EST.
    expect(hospitalInstant("2026-11-01", 0).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(hospitalInstant("2026-11-01", 7 * 60).toISOString()).toBe("2026-11-01T12:00:00.000Z");
    // Spring forward (Mar 8 2026): 07:00 is EDT.
    expect(hospitalInstant("2026-03-08", 7 * 60).toISOString()).toBe("2026-03-08T11:00:00.000Z");
  });

  it("reads minutes since hospital midnight", () => {
    expect(hospitalMinutesOfDay(new Date("2026-10-19T23:30:00.000Z"))).toBe(19 * 60 + 30);
    expect(hospitalDate(new Date("2026-10-20T03:30:00.000Z"))).toBe("2026-10-19");
  });

  it("steps and lists day keys across month ends", () => {
    expect(addDaysToKey("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysToKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(dayKeysBetween("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(dayKeysBetween("2026-11-02", "2026-11-01")).toEqual([]);
  });
});

describe("hospitalTime (24h)", () => {
  it("prints midnight as 00:00 on every runtime (Node's ICU defaults to 24:00)", () => {
    expect(hospitalTime(new Date("2026-10-18T04:00:00.000Z"), false)).toBe("00:00");
    expect(hospitalTime(new Date("2026-10-18T11:00:00.000Z"), false)).toBe("07:00");
    expect(hospitalTime(new Date("2026-10-18T11:00:00.000Z"))).toBe("7:00 AM");
  });
});
