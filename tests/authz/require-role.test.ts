import { describe, it, expect } from "vitest";
import { requireRole, AuthorizationError, type Actor } from "@/lib/authz";

const admin: Actor = { id: "u1", role: "ADMIN" };
const staff: Actor = { id: "u2", role: "STAFF" };

describe("requireRole", () => {
  it("returns the actor when the role is allowed", () => {
    expect(requireRole(admin, "ADMIN")).toBe(admin);
  });

  it("accepts any one of several allowed roles", () => {
    expect(requireRole(staff, "ADMIN", "STAFF")).toBe(staff);
  });

  it("throws AuthorizationError when the role is not allowed", () => {
    expect(() => requireRole(staff, "ADMIN")).toThrow(AuthorizationError);
    expect(() => requireRole(staff, "ADMIN")).toThrow("FORBIDDEN");
  });

  it("rejects when no roles are allowed at all", () => {
    expect(() => requireRole(admin)).toThrow(AuthorizationError);
  });
});
