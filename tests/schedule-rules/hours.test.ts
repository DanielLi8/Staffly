import { describe, it, expect } from "vitest";
import { consecutiveDayStreak, payPeriodHours, windowHours } from "@/lib/schedule-rules/hours";
import { DAY, NIGHT, shift } from "./fixtures";

describe("windowHours", () => {
  it("measures a normal shift", () => {
    expect(windowHours(shift("d", "2026-10-20", DAY))).toBe(8);
  });

  it("handles fractional hours", () => {
    expect(windowHours(shift("d", "2026-10-20", [11, 14.5]))).toBe(3.5);
  });

  it("never returns a negative duration", () => {
    expect(
      windowHours({ startsAt: new Date("2026-08-12T19:00:00Z"), endsAt: new Date("2026-08-12T11:00:00Z") })
    ).toBe(0);
  });

  it("counts real time across the DST change (the fall-back night is 9 h, spring-forward 7 h)", () => {
    expect(windowHours(shift("n", "2026-10-31", NIGHT))).toBe(9);
    expect(windowHours(shift("n", "2027-03-13", NIGHT))).toBe(7);
  });
});

describe("payPeriodHours", () => {
  it("sums only shifts starting in the same pay period", () => {
    const shifts = [
      shift("a", "2026-10-18", DAY),
      shift("b", "2026-10-31", NIGHT), // starts in Oct 18-31, runs into Nov 1
      shift("c", "2026-11-01", DAY),
    ];
    expect(payPeriodHours(shifts, new Date("2026-10-25T12:00:00Z"))).toBe(17);
    expect(payPeriodHours(shifts, new Date("2026-11-05T12:00:00Z"))).toBe(8);
  });
});

describe("consecutiveDayStreak", () => {
  it("counts the target day plus the run on both sides", () => {
    const shifts = ["2026-10-19", "2026-10-20", "2026-10-22"].map((k) => shift(k, k, DAY));
    expect(consecutiveDayStreak(shifts, shift("t", "2026-10-21", DAY).startsAt)).toBe(4);
  });

  it("puts a night on the day it starts", () => {
    const night = shift("n", "2026-10-19", NIGHT); // Mon 23:00 -> Tue 07:00
    expect(consecutiveDayStreak([night], shift("t", "2026-10-21", DAY).startsAt)).toBe(1);
    expect(consecutiveDayStreak([night], shift("t", "2026-10-20", DAY).startsAt)).toBe(2);
  });

  it("counts one day once however many shifts it has", () => {
    const shifts = [shift("a", "2026-10-20", DAY), shift("b", "2026-10-20", [15, 23])];
    expect(consecutiveDayStreak(shifts, shift("t", "2026-10-20", [1, 5]).startsAt)).toBe(1);
  });
});
