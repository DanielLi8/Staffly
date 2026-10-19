import { describe, it, expect } from "vitest";
import { addHours, addMinutes, subHours } from "date-fns";
import {
  SHIFT_TIME_MESSAGES,
  validateShiftTimes,
} from "@/lib/shifts/validation";
import {
  combineDateAndTime,
  formatTimeInput,
  parseTimeInput,
} from "@/lib/shifts/time";

const start = addHours(new Date(), 24);
const valid = {
  startsAt: start,
  endsAt: addHours(start, 12),
};

describe("validateShiftTimes", () => {
  it("accepts valid times", () => {
    expect(validateShiftTimes(valid)).toEqual({});
  });

  it("rejects an end time at or before the start", () => {
    expect(validateShiftTimes({ ...valid, endsAt: start }).endsAt).toBe(
      SHIFT_TIME_MESSAGES.endBeforeStart
    );
    expect(
      validateShiftTimes({ ...valid, endsAt: subHours(start, 1) }).endsAt
    ).toBe(SHIFT_TIME_MESSAGES.endBeforeStart);
  });

  // Captain decision (2026-10-15): any future shift can be posted. A sick call
  // minutes before the start is exactly when a callout is needed.
  it("accepts a shift starting in a few minutes - there is no minimum lead time", () => {
    const now = new Date();
    const soon = addMinutes(now, 5);
    expect(validateShiftTimes({ startsAt: soon, endsAt: addHours(soon, 8) }, now)).toEqual({});
  });

  it("rejects a shift that has already started", () => {
    const now = new Date();
    expect(
      validateShiftTimes({ startsAt: now, endsAt: addHours(now, 8) }, now).startsAt
    ).toBe(SHIFT_TIME_MESSAGES.startInPast);
    expect(
      validateShiftTimes(
        { startsAt: subHours(now, 1), endsAt: addHours(now, 7) },
        now
      ).startsAt
    ).toBe(SHIFT_TIME_MESSAGES.startInPast);
  });
});

describe("parseTimeInput", () => {
  it.each([
    ["7:00 AM", 7, 0],
    ["7:00 PM", 19, 0],
    ["7 pm", 19, 0],
    ["12:00 AM", 0, 0],
    ["12:30 PM", 12, 30],
    ["07:45", 7, 45],
    ["0745", 7, 45],
    ["19:15", 19, 15],
    ["  7:05a.m. ", 7, 5],
  ])("parses %s", (input, hours, minutes) => {
    expect(parseTimeInput(input)).toEqual({ hours, minutes });
  });

  it.each(["", "abc", "25:00", "7:75", "13:00 PM", "noon"])(
    "rejects %s",
    (input) => {
      expect(parseTimeInput(input)).toBeNull();
    }
  );
});

describe("formatTimeInput / combineDateAndTime", () => {
  it("round-trips a time through the AM/PM text form", () => {
    const d = new Date(2026, 7, 9, 19, 30);
    expect(formatTimeInput(d)).toBe("7:30 PM");
    expect(combineDateAndTime("2026-08-09", formatTimeInput(d))).toEqual(d);
  });

  it("returns null for an unreadable date or time", () => {
    expect(combineDateAndTime("nope", "7:00 AM")).toBeNull();
    expect(combineDateAndTime("2026-08-09", "half past seven")).toBeNull();
  });
});
