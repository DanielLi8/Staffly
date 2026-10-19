import type { Prisma } from "@prisma/client";

/**
 * A minimal evaluator for the subset of Prisma ShiftWhereInput the authz layer
 * produces (AND / OR / departmentId / status / assignedWorkerId / bids.some /
 * id). It lets us assert what a scoped query would ACTUALLY return against a
 * fixed dataset, proving the access boundary rather than just eyeballing the
 * filter object. Prisma AND/OR semantics are what we model here.
 */
export type FakeShift = {
  id: string;
  departmentId: string;
  status: "OPEN" | "ASSIGNED" | "CLOSED" | "CANCELLED";
  assignedWorkerId: string | null;
  bids: { workerId: string }[];
};

export function matches(shift: FakeShift, where: Prisma.ShiftWhereInput): boolean {
  if (where.AND) {
    const clauses = Array.isArray(where.AND) ? where.AND : [where.AND];
    if (!clauses.every((c) => matches(shift, c))) return false;
  }
  if (where.OR) {
    const clauses = Array.isArray(where.OR) ? where.OR : [where.OR];
    if (!clauses.some((c) => matches(shift, c))) return false;
  }
  if (where.id !== undefined) {
    if (shift.id !== where.id) return false;
  }
  if (where.departmentId !== undefined) {
    if (shift.departmentId !== where.departmentId) return false;
  }
  if (where.status !== undefined) {
    if (shift.status !== where.status) return false;
  }
  if (where.assignedWorkerId !== undefined) {
    if (shift.assignedWorkerId !== where.assignedWorkerId) return false;
  }
  if (where.bids && typeof where.bids === "object" && "some" in where.bids) {
    const some = (where.bids as { some?: { workerId?: string } }).some;
    if (some?.workerId !== undefined) {
      if (!shift.bids.some((b) => b.workerId === some.workerId)) return false;
    }
  }
  return true;
}

export function query(shifts: FakeShift[], where: Prisma.ShiftWhereInput): FakeShift[] {
  return shifts.filter((s) => matches(s, where));
}
