import type { Prisma, Role } from "@prisma/client";

/**
 * The authorization layer. Pure and dependency-free (no DB, no session) so it
 * can be unit-tested in isolation and reused anywhere an {@link Actor} is known.
 *
 * The access boundary is the point of Phase 2: a UNIT_CLERK must be able to read
 * ONLY their own department's shifts. That guarantee lives here, at the data
 * layer, via {@link shiftReadScope} + {@link shiftListWhere} - not in the UI.
 */

/** A sentinel department id that matches no real row, used to fail closed. */
const NONE = "__none__";

/** The minimal, typed identity used for every authorization decision. */
export interface Actor {
  id: string;
  role: Role;
  clerkDepartmentId: string | null;
}

/** Thrown by {@link requireRole} when an actor lacks an allowed role. */
export class AuthorizationError extends Error {
  constructor(message = "FORBIDDEN") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/**
 * Assert that `actor` holds one of `roles`. Throws {@link AuthorizationError}
 * otherwise. Returns the actor so it can be used inline.
 */
export function requireRole(actor: Actor, ...roles: Role[]): Actor {
  if (!roles.includes(actor.role)) {
    throw new AuthorizationError("FORBIDDEN");
  }
  return actor;
}

/**
 * The set of shifts an actor is allowed to READ, expressed as a Prisma filter.
 *
 * - SCHEDULER: every shift (the merged scheduler + admin role).
 * - UNIT_CLERK: only their single `clerkDepartmentId`. If unset, matches nothing.
 * - STAFF: shifts they can act on - open ones, ones they bid on, or ones
 *   assigned to them.
 */
export function shiftReadScope(actor: Actor): Prisma.ShiftWhereInput {
  switch (actor.role) {
    case "SCHEDULER":
      return {};
    case "UNIT_CLERK":
      return { departmentId: actor.clerkDepartmentId ?? NONE };
    case "STAFF":
      return {
        OR: [
          { status: "OPEN" },
          { assignedWorkerId: actor.id },
          { bids: { some: { workerId: actor.id } } },
        ],
      };
    default:
      // Fail closed for any unexpected role.
      return { id: NONE };
  }
}

/**
 * The canonical enforcement pattern for every schedule / shift-list query.
 *
 * The read scope is AND-ed into the query UNCONDITIONALLY, so a caller-supplied
 * filter can only ever narrow the result set, never widen it. A UNIT_CLERK who
 * passes another department's id still gets their own scope AND-ed in, which
 * makes a cross-department read structurally impossible rather than merely
 * hidden in the UI.
 */
export function shiftListWhere(
  actor: Actor,
  callerFilter: Prisma.ShiftWhereInput = {}
): Prisma.ShiftWhereInput {
  return { AND: [shiftReadScope(actor), callerFilter] };
}
