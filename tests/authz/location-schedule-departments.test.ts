import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  department: { findMany: vi.fn() },
  departmentMembership: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import { resolveLocationScheduleDepartmentIds } from "@/lib/authz/staff-departments";

describe("resolveLocationScheduleDepartmentIds", () => {
  beforeEach(() => {
    db.department.findMany.mockReset().mockResolvedValue([{ id: "er" }, { id: "icu" }, { id: "med" }]);
    db.departmentMembership.findMany.mockReset().mockResolvedValue([{ departmentId: "icu" }]);
  });

  it("gives STAFF only their own department memberships", async () => {
    await expect(resolveLocationScheduleDepartmentIds({ id: "w1", role: "STAFF" })).resolves.toEqual(["icu"]);
    expect(db.department.findMany).not.toHaveBeenCalled();
  });

  it("gives an ADMIN previewing the worker portal every department, not a dead end", async () => {
    await expect(resolveLocationScheduleDepartmentIds({ id: "a1", role: "ADMIN" })).resolves.toEqual([
      "er",
      "icu",
      "med",
    ]);
    expect(db.departmentMembership.findMany).not.toHaveBeenCalled();
  });
});
