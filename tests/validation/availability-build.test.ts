import { describe, it, expect } from "vitest";
import { AVAILABILITY_MESSAGES, buildAvailabilityRows, MAX_AVAILABILITY_DAYS } from "@/lib/availability/build";
import { AVAILABILITY_PRESETS } from "@/lib/availability/blocks";
import { applyQuickPick, selectedDayKeys, selectionOf, toggleDay, weekOf } from "@/lib/availability/selection";
import { dayKeysBetween } from "@/lib/timezone";

const preset = (id: string) => AVAILABILITY_PRESETS.find((p) => p.id === id)!.blocks;

describe("buildAvailabilityRows", () => {
  it("rejects an empty day selection, no blocks, and too many days", () => {
    expect(buildAvailabilityRows([], preset("days"))).toEqual({ ok: false, error: AVAILABILITY_MESSAGES.noDaysSelected });
    expect(buildAvailabilityRows(["2026-10-19"], [])).toEqual({ ok: false, error: AVAILABILITY_MESSAGES.noBlocks });
    const tooMany = dayKeysBetween("2026-01-01", "2026-12-31").slice(0, MAX_AVAILABILITY_DAYS + 1);
    expect(buildAvailabilityRows(tooMany, preset("days"))).toEqual({ ok: false, error: AVAILABILITY_MESSAGES.tooManyDays });
  });

  it("rejects times off the 15-minute grid and zero-length ranges", () => {
    expect(buildAvailabilityRows(["2026-10-19"], [{ status: "AVAILABLE", startMinute: 425, endMinute: 900 }]).ok).toBe(false);
    expect(buildAvailabilityRows(["2026-10-19"], [{ status: "AVAILABLE", startMinute: 420, endMinute: 420 }]).ok).toBe(false);
    expect(buildAvailabilityRows(["2026-10-19"], [{ status: "AVAILABLE", startMinute: 0, endMinute: 1455 }]).ok).toBe(false);
  });

  it("applies Days 07-19 on the hospital clock", () => {
    const result = buildAvailabilityRows(["2026-10-19"], preset("days"));
    expect(result).toEqual({
      ok: true,
      rows: [
        {
          dayKey: "2026-10-19",
          status: "AVAILABLE",
          startsAt: new Date("2026-10-19T11:00:00.000Z"),
          endsAt: new Date("2026-10-19T23:00:00.000Z"),
        },
      ],
    });
  });

  it("runs Nights 19-07 into the next morning", () => {
    const result = buildAvailabilityRows(["2026-10-22"], preset("nights"));
    expect(result.ok && result.rows[0]).toMatchObject({
      startsAt: new Date("2026-10-22T23:00:00.000Z"),
      endsAt: new Date("2026-10-23T11:00:00.000Z"),
    });
  });

  it("covers the whole day for All day and Not available", () => {
    const all = buildAvailabilityRows(["2026-10-19"], preset("all-day"));
    const off = buildAvailabilityRows(["2026-10-19"], preset("not-available"));
    expect(all.ok && all.rows[0]).toMatchObject({ status: "AVAILABLE", startsAt: new Date("2026-10-19T04:00:00.000Z"), endsAt: new Date("2026-10-20T04:00:00.000Z") });
    expect(off.ok && off.rows[0]).toMatchObject({ status: "UNAVAILABLE", startsAt: new Date("2026-10-19T04:00:00.000Z"), endsAt: new Date("2026-10-20T04:00:00.000Z") });
  });

  it("applies every block to every selected day", () => {
    const result = buildAvailabilityRows(
      ["2026-10-20", "2026-10-19"],
      [
        { status: "AVAILABLE", startMinute: 420, endMinute: 720 },
        { status: "UNAVAILABLE", startMinute: 720, endMinute: 900 },
      ]
    );
    expect(result.ok && result.rows.map((r) => [r.dayKey, r.status])).toEqual([
      ["2026-10-19", "AVAILABLE"],
      ["2026-10-19", "UNAVAILABLE"],
      ["2026-10-20", "AVAILABLE"],
      ["2026-10-20", "UNAVAILABLE"],
    ]);
  });
});

describe("range editing: preset applied to a date range with days ticked off", () => {
  it("Oct 19-25 minus Saturday, Days 07-19 -> six days, none on Saturday", () => {
    const range = toggleDay(selectionOf("2026-10-19", "2026-10-25"), "2026-10-24");
    const days = selectedDayKeys(range);
    expect(days).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-25"]);

    const result = buildAvailabilityRows(days, preset("days"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(6);
    expect(result.rows.some((r) => r.dayKey === "2026-10-24")).toBe(false);
  });

  it("a whole week is Monday to Sunday, and Weekdays drops the weekend", () => {
    const week = weekOf("2026-10-22");
    expect(selectedDayKeys(week)).toEqual(dayKeysBetween("2026-10-19", "2026-10-25"));
    expect(selectedDayKeys(applyQuickPick(week, "weekdays"))).toEqual(dayKeysBetween("2026-10-19", "2026-10-23"));
    expect(selectedDayKeys(applyQuickPick(week, "weekends"))).toEqual(["2026-10-24", "2026-10-25"]);
  });
});
