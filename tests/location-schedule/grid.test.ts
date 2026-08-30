import { describe, it, expect } from "vitest";
import { buildLocationScheduleGrid, type GridShift, type RosterMember } from "@/lib/location-schedule/grid";

// All times below are hospital-timezone (America/New_York) wall-clock times,
// expressed as UTC instants for a fixed January date (EST, UTC-5), matching
// the convention in tests/validation/shift-type.test.ts.
function ny(day: number, hour: number, minute = 0): Date {
  const utcHour = (hour + 5) % 24;
  const dayOffset = hour + 5 >= 24 ? 1 : 0;
  return new Date(Date.UTC(2026, 0, day + dayOffset, utcHour, minute));
}

function member(userId: string, name = userId): RosterMember {
  return { userId, name, position: "RN", image: null, title: "Staff RN" };
}

function shift(id: string, startsAt: Date, endsAt: Date, assignedWorkerId: string | null): GridShift {
  return { id, startsAt, endsAt, unit: "4B", roleNeeded: "RN", status: "ASSIGNED", assignedWorkerId };
}

const days = [ny(10, 0), ny(11, 0), ny(12, 0)]; // Jan 10, 11, 12 (hospital-tz midnight markers)

describe("buildLocationScheduleGrid", () => {
  it("gives every roster member a row, even with zero shifts", () => {
    const rows = buildLocationScheduleGrid([member("w1"), member("w2")], [], days);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      for (const key of ["2026-01-10", "2026-01-11", "2026-01-12"]) {
        expect(row.cellsByDay.get(key)).toEqual([]);
      }
    }
  });

  it("buckets a shift under the hospital-timezone calendar date of startsAt, not endsAt", () => {
    // Night shift: starts 23:00 on Jan 11, ends 07:00 on Jan 12.
    const night = shift("s1", ny(11, 23), ny(12, 7), "w1");
    const rows = buildLocationScheduleGrid([member("w1")], [night], days);
    const row = rows[0];
    expect(row.cellsByDay.get("2026-01-11")).toEqual([night]);
    expect(row.cellsByDay.get("2026-01-12")).toEqual([]);
  });

  it("groups shifts by assignedWorkerId, ignoring shifts assigned to other workers", () => {
    const forW1 = shift("s1", ny(10, 7), ny(10, 15), "w1");
    const forW2 = shift("s2", ny(10, 7), ny(10, 15), "w2");
    const rows = buildLocationScheduleGrid([member("w1"), member("w2")], [forW1, forW2], days);
    expect(rows.find((r) => r.member.userId === "w1")!.cellsByDay.get("2026-01-10")).toEqual([forW1]);
    expect(rows.find((r) => r.member.userId === "w2")!.cellsByDay.get("2026-01-10")).toEqual([forW2]);
  });

  it("drops unassigned shifts (assignedWorkerId null) - the grid only ever shows filled shifts", () => {
    const open = shift("s1", ny(10, 7), ny(10, 15), null);
    const rows = buildLocationScheduleGrid([member("w1")], [open], days);
    expect(rows[0].cellsByDay.get("2026-01-10")).toEqual([]);
  });

  it("stacks 2+ shifts for the same member/day, ordered by startsAt", () => {
    const later = shift("s2", ny(10, 15), ny(10, 23), "w1");
    const earlier = shift("s1", ny(10, 7), ny(10, 15), "w1");
    const rows = buildLocationScheduleGrid([member("w1")], [later, earlier], days);
    expect(rows[0].cellsByDay.get("2026-01-10")).toEqual([earlier, later]);
  });

  it("excludes a shift that falls outside the given days array", () => {
    const outOfRange = shift("s1", ny(20, 7), ny(20, 15), "w1");
    const rows = buildLocationScheduleGrid([member("w1")], [outOfRange], days);
    for (const bucket of Array.from(rows[0].cellsByDay.values())) {
      expect(bucket).toEqual([]);
    }
  });
});
