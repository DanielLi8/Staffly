import { describe, it, expect } from "vitest";
import { addDays, clampRange, selectedDayKeys, selectionOf, toggleDay } from "@/lib/availability/selection";
import { MAX_AVAILABILITY_DAYS } from "@/lib/availability/build";

describe("day selection", () => {
  it("toggles a day inside the range off and back on", () => {
    const base = selectionOf("2026-10-19", "2026-10-21");
    const off = toggleDay(base, "2026-10-20");
    expect(selectedDayKeys(off)).toEqual(["2026-10-19", "2026-10-21"]);
    expect(selectedDayKeys(toggleDay(off, "2026-10-20"))).toEqual(["2026-10-19", "2026-10-20", "2026-10-21"]);
  });

  it("growing the range to a tapped day never silently adds the days in between", () => {
    const grown = toggleDay(selectionOf("2026-10-19", "2026-10-19"), "2026-10-22");
    expect(grown).toMatchObject({ from: "2026-10-19", to: "2026-10-22" });
    expect(selectedDayKeys(grown)).toEqual(["2026-10-19", "2026-10-22"]);
    const earlier = toggleDay(grown, "2026-10-17");
    expect(selectedDayKeys(earlier)).toEqual(["2026-10-17", "2026-10-19", "2026-10-22"]);
  });

  it("a dragged run switches all of its days on, including ticked-off ones", () => {
    const base = toggleDay(selectionOf("2026-10-19", "2026-10-21"), "2026-10-20");
    const dragged = addDays(base, ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
    expect(selectedDayKeys(dragged)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
  });

  it("caps a typed range at the per-save maximum", () => {
    expect(clampRange("2026-01-01", "2026-12-31")).toEqual({
      from: "2026-01-01",
      to: "2026-04-02",
      clamped: true,
    });
    expect(MAX_AVAILABILITY_DAYS).toBe(92);
    expect(clampRange("2026-10-19", "2026-10-25").clamped).toBe(false);
  });
});
