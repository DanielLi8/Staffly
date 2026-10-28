import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import {
  CAPABILITIES,
  PLANNED_RULES,
  AuthorizationError,
  can,
  canUseLoginPortal,
  grantFor,
  requireCapability,
  roleWhere,
  rolesWith,
  type Capability,
  type CapabilityRow,
  type PlannedRole,
} from "@/lib/authz";

const admin = { id: "a1", role: "ADMIN" as Role };
const staff = { id: "w1", role: "STAFF" as Role };
const unknown = { id: "x1", role: "UNIT_CLERK" as Role };

const rows = Object.entries(CAPABILITIES) as [Capability, CapabilityRow][];
const PLANNED_ROLES: PlannedRole[] = ["WORKER", "UAC", "STAFFING_ADMIN", "MANAGER", "SYSTEM_ADMIN"];

describe("the matrix reproduces today's access exactly (no behaviour change)", () => {
  // Every active capability and what each current role holds. Changing this
  // table is changing who can do what - it should only happen in a role PR.
  const today: Record<string, { STAFF?: string; ADMIN?: string }> = {
    "portal.admin": { ADMIN: "all" },
    "portal.staffSignIn": { STAFF: "own" },
    "viewMode.switch": { ADMIN: "all" },
    "schedule.beScheduled": { STAFF: "own" },
    "locationSchedule.view": { STAFF: "memberDepartments", ADMIN: "all" },
    "schedule.viewAnyone": { ADMIN: "all" },
    "shift.viewAll": { ADMIN: "all" },
    "staff.viewDirectory": { ADMIN: "all" },
    "shift.bid": { STAFF: "own" },
    "bid.withdrawOwn": { STAFF: "own" },
    "bid.viewOwn": { STAFF: "own" },
    "availability.editOwn": { STAFF: "own" },
    "swap.request": { STAFF: "own" },
    "profile.verifyPhone": { STAFF: "own", ADMIN: "own" },
    "notifications.readOwn": { STAFF: "own", ADMIN: "own" },
    "shift.create": { ADMIN: "all" },
    "shift.editTime": { ADMIN: "all" },
    "shift.cancel": { ADMIN: "all" },
    "shift.award": { ADMIN: "all" },
    "callout.control": { ADMIN: "all" },
    "swap.approve": { ADMIN: "all" },
    "staff.setTeamLead": { ADMIN: "all" },
  };

  it("has exactly these active rows", () => {
    const active = rows.filter(([, r]) => r.status === "active").map(([c]) => c);
    expect(active.sort()).toEqual(Object.keys(today).sort());
  });

  it.each(Object.entries(today))("%s", (capability, grants) => {
    expect(grantFor(staff, capability as Capability)).toBe(grants.STAFF ?? null);
    expect(grantFor(admin, capability as Capability)).toBe(grants.ADMIN ?? null);
  });
});

describe("matrix shape", () => {
  it.each(rows)("%s has a target for every planned role", (_capability, row) => {
    expect(Object.keys(row.target).sort()).toEqual([...PLANNED_ROLES].sort());
  });

  it.each(rows.filter(([, r]) => r.status === "planned"))("planned %s grants nobody anything today", (capability, row) => {
    expect(row.today).toEqual({});
    expect(can(admin, capability)).toBe(false);
    expect(can(staff, capability)).toBe(false);
  });

  it("covers the plan's matrix (about 50 rows)", () => {
    expect(rows.length).toBeGreaterThanOrEqual(50);
  });
});

describe("can()", () => {
  it("fails closed for no actor and unknown roles", () => {
    expect(can(null, "shift.create")).toBe(false);
    expect(can(undefined, "shift.create")).toBe(false);
    expect(can(unknown, "shift.create")).toBe(false);
    expect(can(unknown, "notifications.readOwn")).toBe(false);
  });

  it("without a scope asks whether the capability is held at all", () => {
    expect(can(admin, "shift.create")).toBe(true);
    expect(can(staff, "shift.create")).toBe(false);
    expect(can(staff, "locationSchedule.view")).toBe(true);
  });

  it("an own grant matches only the actor", () => {
    expect(can(staff, "availability.editOwn", { subjectUserId: "w1" })).toBe(true);
    expect(can(staff, "availability.editOwn", { subjectUserId: "w2" })).toBe(false);
    expect(can({ role: "STAFF" as Role }, "availability.editOwn", { subjectUserId: "w1" })).toBe(false);
  });

  it("a memberDepartments grant needs the department and the memberships", () => {
    expect(can(staff, "locationSchedule.view", { departmentId: "er", actorDepartmentIds: ["er"] })).toBe(true);
    expect(can(staff, "locationSchedule.view", { departmentId: "icu", actorDepartmentIds: ["er"] })).toBe(false);
    expect(can(staff, "locationSchedule.view", { departmentId: "er" })).toBe(false);
    expect(can(staff, "locationSchedule.view", {})).toBe(false);
  });

  it("an all grant covers any scope", () => {
    expect(can(admin, "locationSchedule.view", { departmentId: "icu", actorDepartmentIds: [] })).toBe(true);
  });
});

describe("requireCapability", () => {
  it("returns the actor when allowed", () => {
    expect(requireCapability(admin, "shift.award")).toBe(admin);
  });

  it("throws FORBIDDEN otherwise", () => {
    expect(() => requireCapability(staff, "shift.award")).toThrow(AuthorizationError);
    expect(() => requireCapability(staff, "shift.award")).toThrow("FORBIDDEN");
  });
});

describe("rolesWith / roleWhere", () => {
  it("lists the roles holding a capability", () => {
    expect(rolesWith("shift.award")).toEqual(["ADMIN"]);
    expect(rolesWith("schedule.beScheduled")).toEqual(["STAFF"]);
    expect(rolesWith("profile.verifyPhone").sort()).toEqual(["ADMIN", "STAFF"]);
    expect(rolesWith("staff.add")).toEqual([]);
  });

  it("builds a Prisma user filter", () => {
    expect(roleWhere("swap.approve")).toEqual({ role: { in: ["ADMIN"] } });
  });
});

describe("login portals", () => {
  it("lets each role in only through its own portal, as before", () => {
    expect(canUseLoginPortal("STAFF", "STAFF")).toBe(true);
    expect(canUseLoginPortal("ADMIN", "ADMIN")).toBe(true);
    expect(canUseLoginPortal("STAFF", "ADMIN")).toBe(false);
    expect(canUseLoginPortal("ADMIN", "STAFF")).toBe(false);
  });

  it("refuses an unknown portal", () => {
    expect(canUseLoginPortal("ADMIN", "MANAGER")).toBe(false);
    expect(canUseLoginPortal("ADMIN", "toString")).toBe(false);
  });
});

describe("captain decisions are encoded as planned targets", () => {
  const target = (c: Capability) => CAPABILITIES[c].target;

  it("admin-department-scope: UACs own departments only, Staffing Admins view all, Managers their units", () => {
    expect(target("schedule.viewAnyone")).toMatchObject({
      UAC: "departments",
      STAFFING_ADMIN: "readAll",
      MANAGER: "managedWorkers",
    });
    expect(target("locationSchedule.view")).toMatchObject({ UAC: "departments", STAFFING_ADMIN: "readAll" });
    for (const c of ["shift.create", "shift.award", "shift.cancel", "callout.control"] as const) {
      expect(target(c)).toMatchObject({ UAC: "departments", STAFFING_ADMIN: "departments", MANAGER: "managedUnits" });
    }
  });

  it("staff-admin-authority: only System Admins add, deactivate, reactivate staff and grant roles", () => {
    for (const c of ["staff.add", "staff.importCsv", "staff.deactivate", "staff.reactivate", "access.grantRoles"] as const) {
      expect(target(c)).toEqual({ WORKER: "none", UAC: "none", STAFFING_ADMIN: "none", MANAGER: "none", SYSTEM_ADMIN: "all" });
    }
  });

  it("no lock takeover for anyone", () => {
    expect(Object.values(target("lock.takeOver")).every((g) => g === "none")).toBe(true);
  });

  it("manager-approval-scope: worker requests, own-schedule changes and six-week publish need a Manager", () => {
    expect(target("swap.approve")).toMatchObject({ MANAGER: "approves", STAFFING_ADMIN: "none", UAC: "none" });
    expect(target("timeOff.approve")).toMatchObject({ MANAGER: "approves", STAFFING_ADMIN: "none" });
    expect(target("selfSchedule.change")).toMatchObject({ UAC: "needsApproval", STAFFING_ADMIN: "needsApproval" });
    expect(target("planning.publish")).toMatchObject({ STAFFING_ADMIN: "needsApproval", MANAGER: "approves" });
  });

  it("uac-self-scheduling: UACs draft their own line", () => {
    expect(target("planning.draftOwnLine").UAC).toBe("draftOwn");
  });

  it("no admin editing on a phone", () => {
    expect(Object.values(target("admin.editOnPhone")).every((g) => g === "none")).toBe(true);
    expect(PLANNED_RULES.map((r) => r.key)).toContain("NO_PHONE_ADMIN_EDIT");
  });
});
