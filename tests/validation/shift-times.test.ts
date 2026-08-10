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
  bidDeadlineAt: subHours(start, 12),
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

  it("rejects a bid deadline at or after the shift start", () => {
    expect(
      validateShiftTimes({ ...valid, bidDeadlineAt: addHours(start, 1) })
        .bidDeadlineAt
    ).toBe(SHIFT_TIME_MESSAGES.deadlineAfterStart);
    expect(
      validateShiftTimes({ ...valid, bidDeadlineAt: start }).bidDeadlineAt
    ).toBe(SHIFT_TIME_MESSAGES.deadlineAfterStart);
  });

  // Regression for #7: this is the reproduction that used to throw, and the
  // thrown error reached production as an opaque "digest" message.
  it("rejects a bid deadline less than 4 hours before the start", () => {
    expect(
      validateShiftTimes({ ...valid, bidDeadlineAt: subHours(start, 1) })
        .bidDeadlineAt
    ).toBe(SHIFT_TIME_MESSAGES.deadlineTooClose);
    expect(
      validateShiftTimes({
        ...valid,
        bidDeadlineAt: addMinutes(subHours(start, 4), 1),
      }).bidDeadlineAt
    ).toBe(SHIFT_TIME_MESSAGES.deadlineTooClose);
  });

  it("accepts a bid deadline exactly 4 hours before the start", () => {
    expect(
      validateShiftTimes({ ...valid, bidDeadlineAt: subHours(start, 4) })
    ).toEqual({});
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
