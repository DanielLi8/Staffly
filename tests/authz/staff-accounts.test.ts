import { describe, it, expect } from "vitest";
import { canManageStaffAccounts, parseStaffAccountManagers } from "@/lib/authz/staff-accounts";

const admin = { id: "cladmin1", role: "ADMIN" as const, email: "Sarah.Chen@Staffly.com" };

describe("canManageStaffAccounts", () => {
  it("fails closed when the allowlist is unset or empty", () => {
    expect(canManageStaffAccounts(admin, parseStaffAccountManagers(undefined))).toBe(false);
    expect(canManageStaffAccounts(admin, parseStaffAccountManagers(" , "))).toBe(false);
  });

  it("allows an ADMIN listed by email, case-insensitively", () => {
    expect(canManageStaffAccounts(admin, parseStaffAccountManagers("sarah.chen@staffly.com"))).toBe(true);
  });

  it("allows an ADMIN listed by user id", () => {
    expect(canManageStaffAccounts(admin, parseStaffAccountManagers("someone@x.ca, cladmin1"))).toBe(true);
  });

  it("refuses an ADMIN who isn't listed", () => {
    expect(canManageStaffAccounts(admin, parseStaffAccountManagers("other@staffly.com cladmin2"))).toBe(false);
  });

  it("never allows a STAFF actor, even when listed", () => {
    const staff = { id: "clstaff1", role: "STAFF" as const, email: "maria@staffly.com" };
    expect(canManageStaffAccounts(staff, parseStaffAccountManagers("maria@staffly.com clstaff1"))).toBe(false);
  });

  it("reads STAFF_ACCOUNT_MANAGERS by default", () => {
    const prev = process.env.STAFF_ACCOUNT_MANAGERS;
    try {
      process.env.STAFF_ACCOUNT_MANAGERS = "sarah.chen@staffly.com";
      expect(canManageStaffAccounts(admin)).toBe(true);
      delete process.env.STAFF_ACCOUNT_MANAGERS;
      expect(canManageStaffAccounts(admin)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.STAFF_ACCOUNT_MANAGERS;
      else process.env.STAFF_ACCOUNT_MANAGERS = prev;
    }
  });
});
