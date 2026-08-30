import { db } from "@/lib/db";
import { canViewLocationSchedule, locationScheduleShiftWhere, type Actor } from "@/lib/authz";
import { buildLocationScheduleGrid, type LocationScheduleRow } from "./grid";

export interface LoadLocationScheduleResult {
  department: { id: string; name: string; code: string; iconKey: string; wing: string | null };
  rows: LocationScheduleRow[];
}

/**
 * The ONE loader for the Location Schedule: gates on {@link canViewLocationSchedule}
 * and fails closed (returns `null` - callers must 404) before running either
 * query, then runs the two-query shape (roster, then shifts in range) and
 * groups them into rows via the pure {@link buildLocationScheduleGrid}.
 *
 * `staffMemberDepartmentIds` only matters for a STAFF actor (see
 * `resolveStaffDepartmentIds`); every other role ignores it.
 */
export async function loadLocationSchedule(
  actor: Actor,
  departmentId: string,
  range: { gte: Date; lt: Date },
  days: Date[],
  staffMemberDepartmentIds: string[] = []
): Promise<LoadLocationScheduleResult | null> {
  if (!canViewLocationSchedule(actor, departmentId, staffMemberDepartmentIds)) return null;

  const department = await db.department.findUnique({
    where: { id: departmentId },
    select: { id: true, name: true, code: true, iconKey: true, wing: true },
  });
  if (!department) return null;

  const [roster, shifts] = await Promise.all([
    db.departmentMembership.findMany({
      where: { departmentId },
      include: { user: { select: { id: true, name: true, position: true, image: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    db.shift.findMany({
      where: locationScheduleShiftWhere(departmentId, range),
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        unit: true,
        roleNeeded: true,
        status: true,
        assignedWorkerId: true,
      },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  const rosterMembers = roster.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    position: m.user.position,
    image: m.user.image,
    title: m.title,
  }));

  const rows = buildLocationScheduleGrid(rosterMembers, shifts, days);

  return { department, rows };
}
