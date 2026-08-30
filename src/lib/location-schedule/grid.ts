import { hospitalDate } from "@/lib/timezone";

export interface RosterMember {
  userId: string;
  name: string;
  position: string | null;
  image: string | null;
  /** The roster-specific title assigned via `DepartmentMembership.title`. */
  title: string;
}

export interface GridShift {
  id: string;
  startsAt: Date;
  endsAt: Date;
  unit: string;
  roleNeeded: string;
  status: "OPEN" | "ASSIGNED" | "CLOSED" | "CANCELLED";
  assignedWorkerId: string | null;
}

export interface LocationScheduleRow {
  member: RosterMember;
  /** Shifts for this member, keyed by the hospital-timezone calendar date (`yyyy-MM-dd`) of `startsAt`. */
  cellsByDay: Map<string, GridShift[]>;
}

/**
 * Pure: groups `shifts` by `assignedWorkerId` and buckets each shift into
 * exactly one day column - the hospital-timezone calendar date of
 * `startsAt` - so a night shift starting 23:00 and ending 07:00 the next
 * day appears once, under the day it starts, never duplicated into the
 * next column. Every roster member gets a row, including ones with zero
 * shifts in `days` - dropping them would hide the exact case a scheduler
 * most wants to see (an uncovered slot on their own roster).
 */
export function buildLocationScheduleGrid(
  roster: RosterMember[],
  shifts: GridShift[],
  days: Date[]
): LocationScheduleRow[] {
  const dayKeys = days.map((d) => hospitalDate(d));

  const shiftsByWorker = new Map<string, GridShift[]>();
  for (const shift of shifts) {
    if (!shift.assignedWorkerId) continue;
    const list = shiftsByWorker.get(shift.assignedWorkerId);
    if (list) list.push(shift);
    else shiftsByWorker.set(shift.assignedWorkerId, [shift]);
  }

  return roster.map((member) => {
    const cellsByDay = new Map<string, GridShift[]>();
    for (const key of dayKeys) cellsByDay.set(key, []);

    for (const shift of shiftsByWorker.get(member.userId) ?? []) {
      const bucket = cellsByDay.get(hospitalDate(shift.startsAt));
      // A shift outside `days` (e.g. the query range was widened elsewhere)
      // has no bucket and is silently excluded from this grid - it belongs
      // to a different page of the calendar, not to this render.
      bucket?.push(shift);
    }

    Array.from(cellsByDay.values()).forEach((bucket) => {
      bucket.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    });

    return { member, cellsByDay };
  });
}
