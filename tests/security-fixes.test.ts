import { describe, expect, it } from "vitest";
import { formatShiftDate, formatShiftRange } from "@/lib/utils";
import { HOSPITAL_TIME_ZONE, hospitalDate, hospitalTime } from "@/lib/timezone";
import { LoginThrottle, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS } from "@/lib/login-throttle";
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

  it("allows five failures and throttles the sixth deterministically", () => {
    const throttle = new LoginThrottle();
    const now = 100000;
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      expect(throttle.isAllowed("ip:user", now)).toBe(true);
      throttle.recordFailure("ip:user", now);
    }
    expect(throttle.isAllowed("ip:user", now)).toBe(false);
    expect(throttle.isAllowed("ip:user", now + LOGIN_WINDOW_MS)).toBe(true);
  });

  it("neutralizes formula-leading CSV values", () => {
    expect(csvCell("=HYPERLINK(\"https://evil\")")).toBe("\"'=HYPERLINK(\"\"https://evil\"\")\"");
    expect(csvCell("Emergency")).toBe('"Emergency"');
  });

  it("permits the assigned-shift cancellation control", () => {
    expect(canCancelShift("OPEN")).toBe(true);
    expect(canCancelShift("ASSIGNED")).toBe(true);
    expect(canCancelShift("CLOSED")).toBe(false);
  });

  it("scopes worker availability to open, deadline-passing shifts", () => {
    expect(workerAvailableShiftWhere({ id: "worker", role: "STAFF" }, now)).toEqual({
      AND: [
        { OR: [{ status: "OPEN" }, { assignedWorkerId: "worker" }, { bids: { some: { workerId: "worker" } } }] },
        { status: "OPEN", bidDeadlineAt: { gt: now } },
      ],
    });
  });
});

const now = new Date("2026-08-10T12:00:00.000Z");
