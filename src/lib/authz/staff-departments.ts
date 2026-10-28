import { db } from "@/lib/db";
import { grantFor, type Actor } from "@/lib/authz";

/**
 * Resolves the set of department ids an actor belongs to, for use with
 * {@link canViewLocationSchedule}. Not part of `@/lib/authz` itself - that
 * module is deliberately DB-free and unit-testable in isolation, so this DB
 * read lives alongside it instead. Mirrors the department-id resolution
 * `src/lib/callout/campaign.ts:138,154` already does for cascade targeting.
 *
 * Only an actor whose `locationSchedule.view` grant is `memberDepartments`
 * (STAFF today) needs this lookup - `canViewLocationSchedule` consults it for
 * nobody else - so it returns `[]` for every other actor.
 */
export async function resolveStaffDepartmentIds(actor: Actor): Promise<string[]> {
  if (grantFor(actor, "locationSchedule.view") !== "memberDepartments") return [];

  const memberships = await db.departmentMembership.findMany({
    where: { userId: actor.id },
    select: { departmentId: true },
  });
  return memberships.map((m) => m.departmentId);
}

/**
 * The departments an actor can open in the worker-portal Location Schedule
 * (`/worker/location` and its home-screen card). STAFF get their own
 * memberships, exactly as before. An admin previewing the worker portal
 * ("view as" WORKER) usually has no memberships at all, but their
 * `locationSchedule.view` grant already covers every department - so
 * they get every department, rather than a dead end. The admin roster at
 * `/admin/schedule` is not an option here: middleware deliberately fences
 * `/admin/*` off while the view mode is WORKER.
 */
export async function resolveLocationScheduleDepartmentIds(actor: Actor): Promise<string[]> {
  if (grantFor(actor, "locationSchedule.view") === "all") {
    const departments = await db.department.findMany({ select: { id: true } });
    return departments.map((d) => d.id);
  }
  return resolveStaffDepartmentIds(actor);
}
