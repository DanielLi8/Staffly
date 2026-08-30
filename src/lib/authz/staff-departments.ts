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
