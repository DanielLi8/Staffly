import { db } from "@/lib/db";
import type { Actor } from "@/lib/authz";

/**
 * Resolves the set of department ids a STAFF actor belongs to, for use with
 * {@link canViewLocationSchedule}. Not part of `@/lib/authz` itself - that
 * module is deliberately DB-free and unit-testable in isolation, so this DB
 * read lives alongside it instead. Mirrors the department-id resolution
 * `src/lib/callout/campaign.ts:138,154` already does for cascade targeting.
 *
 * Non-STAFF actors don't need this lookup - `canViewLocationSchedule` only
 * consults it for the STAFF branch - so it returns `[]` for every other role.
 */
export async function resolveStaffDepartmentIds(actor: Actor): Promise<string[]> {
  if (actor.role !== "STAFF") return [];

  const memberships = await db.departmentMembership.findMany({
    where: { userId: actor.id },
    select: { departmentId: true },
  });
  return memberships.map((m) => m.departmentId);
}

/**
 * The departments an actor can open in the worker-portal Location Schedule
 * (`/worker/location` and its home-screen card). STAFF get their own
 * memberships, exactly as before. An ADMIN previewing the worker portal
 * ("view as" WORKER) usually has no memberships at all, but
 * `canViewLocationSchedule` already lets them read every department - so
 * they get every department, rather than a dead end. The admin roster at
 * `/admin/schedule` is not an option here: middleware deliberately fences
 * `/admin/*` off while the view mode is WORKER.
 */
export async function resolveLocationScheduleDepartmentIds(actor: Actor): Promise<string[]> {
  if (actor.role === "ADMIN") {
    const departments = await db.department.findMany({ select: { id: true } });
    return departments.map((d) => d.id);
  }
  return resolveStaffDepartmentIds(actor);
}
