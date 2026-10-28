import { describe, expect, it } from "vitest";
import { formatShiftDate, formatShiftRange } from "@/lib/utils";
import { HOSPITAL_TIME_ZONE, hospitalDate, hospitalTime } from "@/lib/timezone";
import { LOGIN_LIMITS, isOverLimit } from "@/lib/throttle/policy";
import { csvCell } from "@/lib/csv";
import { canCancelShift } from "@/lib/shift-status";
import { workerAvailableShiftWhere } from "@/lib/authz";

describe("security and QA fixes", () => {
  it("formats Eastern time explicitly instead of the server timezone", () => {
    const instant = new Date("2026-08-10T00:30:00.000Z");
    expect(HOSPITAL_TIME_ZONE).toBe("America/New_York");
    expect(hospitalDate(instant)).toBe("2026-08-09");
    expect(hospitalTime(instant)).toBe("8:30 PM");
    expect(formatShiftDate(instant)).toBe("Sun, Aug 9 · 8:30 PM");
    expect(formatShiftRange(instant, new Date("2026-08-10T04:30:00.000Z"))).toBe("8:30 PM – 12:30 AM");
  });

  it("allows five failures per account and address and throttles the sixth", () => {
    // Persistence and the other limits: tests/throttle/login-throttle.test.ts.
    expect(LOGIN_LIMITS.accountAndIp).toEqual({ max: 5, windowMs: 15 * 60 * 1000 });
    for (let failures = 0; failures < 5; failures++) {
      expect(isOverLimit(failures, LOGIN_LIMITS.accountAndIp)).toBe(false);
    }
    expect(isOverLimit(5, LOGIN_LIMITS.accountAndIp)).toBe(true);
  });

  it("neutralizes formula-leading CSV values", () => {
    expect(csvCell("=HYPERLINK(\"https://evil\")")).toBe("\"'=HYPERLINK(\"\"https://evil\"\")\"");
    expect(csvCell("Emergency")).toBe('"Emergency"');
  });

  it("neutralizes CSV values led by a tab or carriage return (F13)", () => {
    // Spreadsheets strip a leading tab/CR, then run the formula behind it.
    expect(csvCell("\t=1+1")).toBe("\"'\t=1+1\"");
    expect(csvCell("\r=1+1")).toBe("\"'\r=1+1\"");
    expect(csvCell("Med\tSurg")).toBe('"Med\tSurg"');
  });

  it("permits the assigned-shift cancellation control", () => {
    expect(canCancelShift("OPEN")).toBe(true);
    expect(canCancelShift("ASSIGNED")).toBe(true);
    expect(canCancelShift("CLOSED")).toBe(false);
  });

  it("scopes worker availability to open shifts that have not ended", () => {
    expect(workerAvailableShiftWhere({ id: "worker", role: "STAFF" }, now)).toEqual({
      AND: [
        { OR: [{ status: "OPEN" }, { assignedWorkerId: "worker" }, { bids: { some: { workerId: "worker" } } }] },
        { status: "OPEN", endsAt: { gt: now } },
      ],
    });
  });
});

const now = new Date("2026-08-10T12:00:00.000Z");
