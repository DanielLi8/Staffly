import { describe, it, expect } from "vitest";
import { hospitalInstant } from "@/lib/timezone";
import { layoutLanes, segmentsByDay, splitIntoDaySegments } from "@/lib/schedule/time-grid";

const week = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];

function shift(id: string, day: string, startMinute: number, endMinute: number) {
  return { id, startsAt: hospitalInstant(day, startMinute), endsAt: hospitalInstant(day, endMinute) };
}

describe("overnight split", () => {
  it("cuts a 19:00-07:00 night shift into evening and morning segments", () => {
    const night = shift("n", "2026-10-22", 19 * 60, 24 * 60 + 7 * 60);
    const segments = splitIntoDaySegments(night, week);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      dayKey: "2026-10-22",
      startMinute: 1140,
      endMinute: 1440,
      continuesFromPreviousDay: false,
      continuesToNextDay: true,
    });
    expect(segments[1]).toMatchObject({
      dayKey: "2026-10-23",
      startMinute: 0,
      endMinute: 420,
      continuesFromPreviousDay: true,
      continuesToNextDay: false,
    });
  });

  it("draws the morning half of a shift that started before the first visible day", () => {
    const night = shift("n", "2026-10-18", 19 * 60, 24 * 60 + 7 * 60);
    const segments = splitIntoDaySegments(night, week);
    expect(segments).toEqual([expect.objectContaining({ dayKey: "2026-10-19", startMinute: 0, endMinute: 420 })]);
  });

  it("does not put a shift ending exactly at midnight on the next day", () => {
    const evening = shift("e", "2026-10-19", 15 * 60, 24 * 60);
    const segments = splitIntoDaySegments(evening, week);
    expect(segments).toEqual([expect.objectContaining({ dayKey: "2026-10-19", startMinute: 900, endMinute: 1440, continuesToNextDay: false })]);
  });

  it("keeps clock positions right on the DST fall-back night", () => {
    const night = shift("n", "2026-10-31", 19 * 60, 24 * 60 + 7 * 60);
    const segments = splitIntoDaySegments(night, ["2026-10-31", "2026-11-01"]);
    expect(segments.map((s) => [s.startMinute, s.endMinute])).toEqual([
      [1140, 1440],
      [0, 420],
    ]);
  });

  it("buckets every item per day, sorted by start", () => {
    const byDay = segmentsByDay(
      [shift("b", "2026-10-20", 12 * 60, 18 * 60), shift("a", "2026-10-20", 7 * 60, 9 * 60)],
      week
    );
    expect(byDay.get("2026-10-20")!.map((s) => s.item.id)).toEqual(["a", "b"]);
    expect(byDay.get("2026-10-21")).toEqual([]);
  });
});

describe("layoutLanes", () => {
  it("puts overlapping shifts side by side and back-to-back ones in one lane", () => {
    const day = "2026-10-20";
    const segments = segmentsByDay(
      [shift("a", day, 7 * 60, 19 * 60), shift("b", day, 15 * 60, 23 * 60), shift("c", day, 23 * 60, 24 * 60)],
      [day]
    ).get(day)!;
    const laid = layoutLanes(segments);
    const byId = Object.fromEntries(laid.map((s) => [s.item.id, s]));
    expect(byId.a).toMatchObject({ lane: 0, laneCount: 2 });
    expect(byId.b).toMatchObject({ lane: 1, laneCount: 2 });
    expect(byId.c).toMatchObject({ lane: 0, laneCount: 1 });
  });
});
