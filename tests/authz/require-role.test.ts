import { describe, it, expect } from "vitest";
import { requireRole, AuthorizationError, type Actor } from "@/lib/authz";

const admin: Actor = { id: "u1", role: "ADMIN", clerkDepartmentId: null };
const staff: Actor = { id: "u2", role: "STAFF", clerkDepartmentId: null };
const clerk: Actor = { id: "u3", role: "UNIT_CLERK", clerkDepartmentId: "clDept_emergency" };

describe("requireRole", () => {
  it("returns the actor when the role is allowed", () => {
    expect(requireRole(admin, "ADMIN")).toBe(admin);
  });

  it("accepts any one of several allowed roles", () => {
    expect(requireRole(clerk, "ADMIN", "UNIT_CLERK")).toBe(clerk);
  });

  it("throws AuthorizationError when the role is not allowed", () => {
    expect(() => requireRole(staff, "ADMIN")).toThrow(AuthorizationError);
    expect(() => requireRole(staff, "ADMIN")).toThrow("FORBIDDEN");
  });

  it("rejects a unit clerk from an admin-only action", () => {
    expect(() => requireRole(clerk, "ADMIN")).toThrow(AuthorizationError);
  });

  it("rejects when no roles are allowed at all", () => {
    expect(() => requireRole(admin)).toThrow(AuthorizationError);
  });
});
