import { describe, it, expect } from "vitest";
import { getInitials, formatShiftRange } from "@/lib/utils";

describe("getInitials", () => {
  it("returns two uppercase letters from a full name", () => {
    expect(getInitials("Maria Santos")).toBe("MS");
  });

  it("returns one letter for a single-word name", () => {
    expect(getInitials("Admin")).toBe("A");
  });

  it("caps at 2 characters", () => {
    expect(getInitials("John Michael Smith")).toBe("JM");
  });
});

describe("formatShiftRange", () => {
  it("formats start and end times correctly", () => {
    const start = new Date("2026-04-10T07:00:00");
    const end = new Date("2026-04-10T15:00:00");
    const result = formatShiftRange(start, end);
    expect(result).toContain("–");
    expect(result).toContain("7:00 AM");
    expect(result).toContain("3:00 PM");
  });
});
