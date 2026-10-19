import { describe, it, expect } from "vitest";
import { shiftReadScope, shiftListWhere, type Actor } from "@/lib/authz";
import { query, type FakeShift } from "./shift-where-eval";

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
