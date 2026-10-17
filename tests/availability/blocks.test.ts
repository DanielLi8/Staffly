import { describe, it, expect } from "vitest";
import { hospitalInstant } from "@/lib/timezone";
import {
  blockLabel,
  blocksFromRows,
  dayKeysLabel,
  groupRowsByDay,
  presetForBlocks,
  selectionPattern,
} from "@/lib/availability/blocks";

function row(day: string, start: number, end: number, status: "AVAILABLE" | "UNAVAILABLE" | "TENTATIVE" = "AVAILABLE") {
  return { startsAt: hospitalInstant(day, start), endsAt: hospitalInstant(day, end), status };
}

describe("blocksFromRows (seeding the editor from what is saved)", () => {
  it("turns a saved 06:00-20:00 day back into that block, not a default", () => {
    expect(blocksFromRows("2026-10-19", [row("2026-10-19", 360, 1200)])).toEqual([
      { status: "AVAILABLE", startMinute: 360, endMinute: 1200 },
    ]);
  });

  it("recognises presets, including the overnight one", () => {
    expect(presetForBlocks(blocksFromRows("2026-10-19", [row("2026-10-19", 1140, 1440 + 420)])!)).toBe("nights");
    expect(presetForBlocks(blocksFromRows("2026-10-19", [row("2026-10-19", 0, 1440, "UNAVAILABLE")])!)).toBe("not-available");
    expect(presetForBlocks(blocksFromRows("2026-10-19", [row("2026-10-19", 360, 1200)])!)).toBeNull();
  });

  it("refuses rows the editor can't express (tentative, longer than a day)", () => {
    expect(blocksFromRows("2026-10-19", [row("2026-10-19", 420, 1140, "TENTATIVE")])).toBeNull();
    expect(blocksFromRows("2026-10-19", [row("2026-10-19", 420, 1440 + 600)])).toBeNull();
  });
});

describe("selectionPattern", () => {
  const rows = groupRowsByDay([
    row("2026-10-19", 360, 1200),
    row("2026-10-20", 360, 1200),
    row("2026-10-21", 420, 1140),
  ]);

  it("is 'same' when every selected day has the same saved blocks", () => {
    expect(selectionPattern(["2026-10-19", "2026-10-20"], rows)).toEqual({
      kind: "same",
      blocks: [{ status: "AVAILABLE", startMinute: 360, endMinute: 1200 }],
    });
  });

  it("is 'mixed' when the days differ, or some are empty", () => {
    expect(selectionPattern(["2026-10-19", "2026-10-21"], rows)).toEqual({ kind: "mixed", daysWithAvailability: 2 });
    expect(selectionPattern(["2026-10-19", "2026-10-22"], rows)).toEqual({ kind: "mixed", daysWithAvailability: 1 });
  });

  it("is 'empty' when nothing is saved on any selected day", () => {
    expect(selectionPattern(["2026-10-22", "2026-10-23"], rows)).toEqual({ kind: "empty" });
  });

  it("owns a night row by the day it starts on", () => {
    const night = groupRowsByDay([row("2026-10-22", 1140, 1440 + 420)]);
    expect(selectionPattern(["2026-10-23"], night)).toEqual({ kind: "empty" });
  });
});

describe("labels", () => {
  it("collapses consecutive days", () => {
    expect(dayKeysLabel(["2026-10-25", "2026-10-19", "2026-10-20", "2026-10-21"])).toBe("Oct 19–21, Oct 25");
    expect(dayKeysLabel(["2026-10-31", "2026-11-01"])).toBe("Oct 31 – Nov 1");
    expect(dayKeysLabel(["2026-10-19"])).toBe("Oct 19");
  });

  it("describes blocks in plain words", () => {
    expect(blockLabel({ status: "AVAILABLE", startMinute: 0, endMinute: 1440 })).toBe("Available all day");
    expect(blockLabel({ status: "AVAILABLE", startMinute: 1140, endMinute: 420 })).toBe("Available 19:00 – 07:00 (next day)");
    expect(blockLabel({ status: "UNAVAILABLE", startMinute: 720, endMinute: 900 })).toBe("Not available 12:00 – 15:00");
  });
});
