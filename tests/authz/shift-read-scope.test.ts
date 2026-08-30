import { describe, it, expect } from "vitest";
import type { Prisma } from "@prisma/client";
import { shiftReadScope, shiftListWhere, type Actor } from "@/lib/authz";

/**
 * A minimal evaluator for the subset of Prisma ShiftWhereInput the authz layer
 * produces (AND / OR / departmentId / status / assignedWorkerId / bids.some /
 * id). It lets us assert what a scoped query would ACTUALLY return against a
 * fixed dataset, proving the access boundary rather than just eyeballing the
 * filter object. Prisma AND/OR semantics are what we model here.
 */
type FakeShift = {
  id: string;
  departmentId: string;
  status: "OPEN" | "ASSIGNED" | "CLOSED" | "CANCELLED";
  assignedWorkerId: string | null;
  bids: { workerId: string }[];
};

function matches(shift: FakeShift, where: Prisma.ShiftWhereInput): boolean {
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

function query(shifts: FakeShift[], where: Prisma.ShiftWhereInput): FakeShift[] {
  return shifts.filter((s) => matches(s, where));
}

const ER = "clDept_emergency";
const ICU = "clDept_icu";
const MED = "clDept_med";

const dataset: FakeShift[] = [
  { id: "s-er-1", departmentId: ER, status: "OPEN", assignedWorkerId: null, bids: [] },
  { id: "s-er-2", departmentId: ER, status: "ASSIGNED", assignedWorkerId: "w9", bids: [{ workerId: "w9" }] },
  { id: "s-icu-1", departmentId: ICU, status: "OPEN", assignedWorkerId: null, bids: [] },
  { id: "s-icu-2", departmentId: ICU, status: "ASSIGNED", assignedWorkerId: "w1", bids: [] },
  { id: "s-med-1", departmentId: MED, status: "OPEN", assignedWorkerId: null, bids: [] },
];

describe("shiftReadScope - ADMIN", () => {
  it("sees every shift across all departments", () => {
    const admin: Actor = { id: "s", role: "ADMIN" };
    expect(shiftReadScope(admin)).toEqual({});
    const result = query(dataset, shiftListWhere(admin));
    expect(result).toHaveLength(dataset.length);
  });
});

describe("shiftReadScope - STAFF", () => {
  it("sees open shifts plus their own assigned/bid shifts across departments", () => {
    const staff: Actor = { id: "w1", role: "STAFF" };
    const result = query(dataset, shiftListWhere(staff));
    // All OPEN shifts + s-icu-2 (assigned to w1).
    expect(result.map((s) => s.id).sort()).toEqual(
      ["s-er-1", "s-icu-1", "s-icu-2", "s-med-1"].sort()
    );
    // Does not include ER assigned shift they have nothing to do with.
    expect(result.some((s) => s.id === "s-er-2")).toBe(false);
  });
});
