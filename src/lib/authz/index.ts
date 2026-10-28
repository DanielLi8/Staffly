import type { Prisma, Role } from "@prisma/client";
import { biddableShiftWhere } from "@/lib/shifts/bid-window";
import { can, grantFor } from "./capabilities";

export * from "./capabilities";

/**
 * The authorization layer. Pure and dependency-free (no DB, no session) so it
 * can be unit-tested in isolation and reused anywhere an {@link Actor} is known.
 *
 * The access boundary is enforced here, at the data layer, via
 * {@link shiftReadScope} + {@link shiftListWhere} - not in the UI. Who may do
 * what is the capability matrix in `./capabilities` ({@link can}); nothing
 * here compares a role to a literal.
 */

/** A sentinel department id that matches no real row, used to fail closed. */
const NONE = "__none__";

/** The minimal, typed identity used for every authorization decision. */
export interface Actor {
  id: string;
  role: Role;
}

/**
 * The set of shifts an actor is allowed to READ, expressed as a Prisma filter.
 *
 * - `shift.viewAll` hospital-wide (ADMIN today): every shift.
 * - `shift.bid` (STAFF today): shifts they can act on - open ones, ones they
 *   bid on, or ones assigned to them.
 * - Anyone else: nothing.
 */
export function shiftReadScope(actor: Actor): Prisma.ShiftWhereInput {
  if (grantFor(actor, "shift.viewAll") === "all") return {};
  if (can(actor, "shift.bid")) {
    return {
      OR: [
        { status: "OPEN" },
        { assignedWorkerId: actor.id },
        { bids: { some: { workerId: actor.id } } },
      ],
    };
  }
  // Fail closed for any unexpected role.
  return { id: NONE };
}

/**
 * The canonical enforcement pattern for every schedule / shift-list query.
 *
 * The read scope is AND-ed into the query UNCONDITIONALLY, so a caller-supplied
 * filter can only ever narrow the result set, never widen it.
 */
export function shiftListWhere(
  actor: Actor,
  callerFilter: Prisma.ShiftWhereInput = {}
): Prisma.ShiftWhereInput {
  return { AND: [shiftReadScope(actor), callerFilter] };
}

/**
 * Shifts a worker can bid on right now: their read scope narrowed by the bid
 * window (see `bidAcceptance` in `src/lib/shifts/bid-window.ts`).
 */
export function workerAvailableShiftWhere(actor: Actor, now = new Date()): Prisma.ShiftWhereInput {
  return shiftListWhere(actor, biddableShiftWhere(now));
}

/**
 * Whether `actor` may view the Location Schedule for `departmentId`. Unlike
 * shiftReadScope, a STAFF actor's allowed department set isn't derivable from
 * the Actor alone - it requires a DepartmentMembership lookup (see
 * `src/lib/callout/campaign.ts:138,154` for the same resolution pattern used
 * elsewhere). That lookup is a DB read, so it happens once at the page/loader
 * level and is passed in here - this function stays pure and unit-testable,
 * matching every other function in this module.
 */
export function canViewLocationSchedule(
  actor: Actor,
  departmentId: string,
  staffMemberDepartmentIds: string[] = []
): boolean {
  return can(actor, "locationSchedule.view", { departmentId, actorDepartmentIds: staffMemberDepartmentIds });
}

/**
 * The shift filter for an ALREADY-AUTHORIZED Location Schedule read.
 * Deliberately not layered on shiftReadScope/shiftListWhere - that boundary
 * is scoped for bidding and would either hide colleagues' assigned shifts
 * from STAFF (breaking the feature) or have to be widened in place (silently
 * loosening STAFF's read scope on every other shift-list query that reuses
 * it). Callers MUST call {@link canViewLocationSchedule} first and fail
 * closed (404) if it returns false - this function only narrows by
 * department + date range and assumes authorization already happened, the
 * same division of labor shiftReadScope/shiftListWhere already use (a
 * boolean/scope check, then an unconditional AND-in of it).
 */
export function locationScheduleShiftWhere(
  departmentId: string,
  range: { gte: Date; lt: Date }
): Prisma.ShiftWhereInput {
  return { departmentId, startsAt: range, assignedWorkerId: { not: null }, status: { not: "CANCELLED" } };
}
