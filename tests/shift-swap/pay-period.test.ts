import { describe, it, expect } from "vitest";
import { calendarDateKey, isSamePayPeriod, payPeriodFor } from "@/lib/shift-swap/pay-period";

describe("payPeriodFor", () => {
  it("resolves the anchor period to Aug 23 - Sep 5, 2026", () => {
    const { start, end } = payPeriodFor(new Date("2026-08-25T12:00:00-04:00"));
    expect(calendarDateKey(start)).toBe("2026-08-23");
    expect(calendarDateKey(end)).toBe("2026-09-05");
  });

  it("resolves the anchor's first day itself into the anchor period", () => {
    const { start, end } = payPeriodFor(new Date("2026-08-23T00:30:00-04:00"));
    expect(calendarDateKey(start)).toBe("2026-08-23");
    expect(calendarDateKey(end)).toBe("2026-09-05");
  });

  it("resolves the day after a period into the next period", () => {
    const { start, end } = payPeriodFor(new Date("2026-09-06T12:00:00-04:00"));
    expect(calendarDateKey(start)).toBe("2026-09-06");
    expect(calendarDateKey(end)).toBe("2026-09-19");
  });

  it("resolves dates before the anchor into the correct preceding period", () => {
    const { start, end } = payPeriodFor(new Date("2026-08-20T12:00:00-04:00"));
    expect(calendarDateKey(start)).toBe("2026-08-09");
    expect(calendarDateKey(end)).toBe("2026-08-22");
  });

  it("classifies by the hospital-timezone calendar day, not UTC", () => {
    // 2026-08-22T23:30 hospital-time (America/New_York, EDT = UTC-4) is
    // 2026-08-23T03:30 UTC - a naive UTC-day read would misclassify this as
    // already inside the Aug 23 period.
    const { start } = payPeriodFor(new Date("2026-08-23T03:30:00Z"));
    expect(calendarDateKey(start)).toBe("2026-08-09");
  });
});

describe("isSamePayPeriod", () => {
  it("is true for two dates in the same period", () => {
    expect(
      isSamePayPeriod(new Date("2026-08-23T07:00:00-04:00"), new Date("2026-09-05T15:00:00-04:00"))
    ).toBe(true);
  });

  it("is false across a period boundary", () => {
    expect(
      isSamePayPeriod(new Date("2026-09-05T23:00:00-04:00"), new Date("2026-09-06T01:00:00-04:00"))
    ).toBe(false);
  });
});
