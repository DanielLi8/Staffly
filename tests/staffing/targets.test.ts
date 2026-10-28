import { describe, it, expect } from "vitest";
import {
  buildTargetBook,
  dayOfWeekOfKey,
  effectiveTarget,
  groupTarget,
  isDayKey,
  isValidTargetCount,
  WEEKDAYS,
  WEEKEND_DAYS,
  type WeeklyTargetLike,
} from "@/lib/staffing/targets";

const D = "tpl-day";
const N = "tpl-night";

// Day RN: 5 on weekdays, 4 on weekends. Night RN only has a Monday row.
const weekly: WeeklyTargetLike[] = [
  ...WEEKDAYS.map((dayOfWeek) => ({ templateId: D, dayOfWeek, role: "RN" as const, count: 5 })),
  ...WEEKEND_DAYS.map((dayOfWeek) => ({ templateId: D, dayOfWeek, role: "RN" as const, count: 4 })),
  { templateId: N, dayOfWeek: "MON", role: "RN", count: 3 },
];

describe("dayOfWeekOfKey", () => {
  it("reads the weekday off a hospital day key, independent of the host timezone", () => {
    expect(dayOfWeekOfKey("2026-10-31")).toBe("SAT");
    expect(dayOfWeekOfKey("2026-11-01")).toBe("SUN"); // the DST fall-back day
    expect(dayOfWeekOfKey("2026-11-02")).toBe("MON");
    expect(dayOfWeekOfKey("2028-02-29")).toBe("TUE");
  });
});

describe("effectiveTarget", () => {
  it("uses the weekday number on a weekday and the weekend number on a weekend", () => {
    const book = buildTargetBook(weekly, []);
    expect(effectiveTarget(book, D, "2026-11-04", "RN")).toEqual({ count: 5, usual: 5, source: "WEEKLY", override: null });
    expect(effectiveTarget(book, D, "2026-11-07", "RN")).toMatchObject({ count: 4, source: "WEEKLY" });
    expect(effectiveTarget(book, D, "2026-11-08", "RN")).toMatchObject({ count: 4, source: "WEEKLY" });
  });

  it("lets a one-date override win over the weekly number, for that date only", () => {
    const override = { templateId: D, date: "2026-10-31", role: "RN" as const, count: 6, reason: "Census" };
    const book = buildTargetBook(weekly, [override]);
    expect(effectiveTarget(book, D, "2026-10-31", "RN")).toEqual({ count: 6, usual: 4, source: "OVERRIDE", override });
    expect(effectiveTarget(book, D, "2026-11-07", "RN")).toMatchObject({ count: 4, source: "WEEKLY" });
  });

  it("keeps an override to its own shift and role", () => {
    const book = buildTargetBook(weekly, [{ templateId: D, date: "2026-11-02", role: "RN", count: 9 }]);
    expect(effectiveTarget(book, N, "2026-11-02", "RN")).toMatchObject({ count: 3, source: "WEEKLY" });
    expect(effectiveTarget(book, D, "2026-11-02", "PSW")).toMatchObject({ count: 0, source: "WEEKLY" });
  });

  it("treats a missing weekly row as nobody needed, and an override of 0 as a real override", () => {
    const book = buildTargetBook(weekly, [{ templateId: N, date: "2026-11-09", role: "RN", count: 0 }]);
    expect(effectiveTarget(book, N, "2026-11-03", "RN")).toMatchObject({ count: 0, usual: 0, source: "WEEKLY" });
    expect(effectiveTarget(book, N, "2026-11-09", "RN")).toMatchObject({ count: 0, usual: 3, source: "OVERRIDE" });
  });
});

describe("groupTarget", () => {
  it("returns the shared number for a group of days, or null when they differ", () => {
    const book = buildTargetBook(weekly, []);
    expect(groupTarget(book, D, "RN", WEEKDAYS)).toBe(5);
    expect(groupTarget(book, D, "RN", WEEKEND_DAYS)).toBe(4);
    expect(groupTarget(book, D, "RN", ["FRI", "SAT"])).toBeNull();
    expect(groupTarget(book, N, "RN", WEEKDAYS)).toBeNull();
  });
});

describe("validation helpers", () => {
  it("accepts only real yyyy-MM-dd dates", () => {
    expect(isDayKey("2026-10-31")).toBe(true);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("2026-1-3")).toBe(false);
    expect(isDayKey(20261031)).toBe(false);
  });

  it("accepts whole counts from 0 to 99", () => {
    expect(isValidTargetCount(0)).toBe(true);
    expect(isValidTargetCount(99)).toBe(true);
    expect(isValidTargetCount(100)).toBe(false);
    expect(isValidTargetCount(-1)).toBe(false);
    expect(isValidTargetCount(1.5)).toBe(false);
  });
});
