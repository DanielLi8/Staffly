import { describe, it, expect } from "vitest";
import { requireRole, AuthorizationError, type Actor } from "@/lib/authz";

const scheduler: Actor = { id: "u1", role: "SCHEDULER", clerkDepartmentId: null };
const staff: Actor = { id: "u2", role: "STAFF", clerkDepartmentId: null };
const clerk: Actor = { id: "u3", role: "UNIT_CLERK", clerkDepartmentId: "clDept_emergency" };

describe("requireRole", () => {
  it("returns the actor when the role is allowed", () => {
    expect(requireRole(scheduler, "SCHEDULER")).toBe(scheduler);
  });

  it("accepts any one of several allowed roles", () => {
    expect(requireRole(clerk, "SCHEDULER", "UNIT_CLERK")).toBe(clerk);
  });

  it("throws AuthorizationError when the role is not allowed", () => {
    expect(() => requireRole(staff, "SCHEDULER")).toThrow(AuthorizationError);
    expect(() => requireRole(staff, "SCHEDULER")).toThrow("FORBIDDEN");
  });

  it("rejects a unit clerk from a scheduler-only action", () => {
    expect(() => requireRole(clerk, "SCHEDULER")).toThrow(AuthorizationError);
  });

  it("rejects when no roles are allowed at all", () => {
    expect(() => requireRole(scheduler)).toThrow(AuthorizationError);
  });
});
