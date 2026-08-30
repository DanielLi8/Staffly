import { describe, it, expect } from "vitest";
import {
  canViewLocationSchedule,
  locationScheduleShiftWhere,
  type Actor,
} from "@/lib/authz";

const ER = "clDept_emergency";
const ICU = "clDept_icu";
const MED = "clDept_med";

describe("canViewLocationSchedule - ADMIN", () => {
  const admin: Actor = { id: "s", role: "ADMIN", clerkDepartmentId: null };

  it("may view every department", () => {
    expect(canViewLocationSchedule(admin, ER)).toBe(true);
    expect(canViewLocationSchedule(admin, ICU)).toBe(true);
    expect(canViewLocationSchedule(admin, MED)).toBe(true);
  });
});

describe("canViewLocationSchedule - UNIT_CLERK", () => {
  const clerkER: Actor = { id: "clerk-er", role: "UNIT_CLERK", clerkDepartmentId: ER };

  it("may view only their own clerkDepartmentId", () => {
    expect(canViewLocationSchedule(clerkER, ER)).toBe(true);
    expect(canViewLocationSchedule(clerkER, ICU)).toBe(false);
    expect(canViewLocationSchedule(clerkER, MED)).toBe(false);
  });

  it("fails closed when clerkDepartmentId is unset", () => {
    const orphan: Actor = { id: "c", role: "UNIT_CLERK", clerkDepartmentId: null };
    expect(canViewLocationSchedule(orphan, ER)).toBe(false);
  });
});

describe("canViewLocationSchedule - STAFF", () => {
  const staffNoMemberships: Actor = { id: "w0", role: "STAFF", clerkDepartmentId: null };
  const staffOneMembership: Actor = { id: "w1", role: "STAFF", clerkDepartmentId: null };
  const staffMultiMembership: Actor = { id: "w2", role: "STAFF", clerkDepartmentId: null };

  it("cannot view any department with zero memberships", () => {
    expect(canViewLocationSchedule(staffNoMemberships, ER, [])).toBe(false);
    expect(canViewLocationSchedule(staffNoMemberships, ICU, [])).toBe(false);
  });

  it("may view only the single department they belong to", () => {
    expect(canViewLocationSchedule(staffOneMembership, ER, [ER])).toBe(true);
    expect(canViewLocationSchedule(staffOneMembership, ICU, [ER])).toBe(false);
    expect(canViewLocationSchedule(staffOneMembership, MED, [ER])).toBe(false);
  });

  it("may view any of several departments they belong to, and no others", () => {
    expect(canViewLocationSchedule(staffMultiMembership, ER, [ER, ICU])).toBe(true);
    expect(canViewLocationSchedule(staffMultiMembership, ICU, [ER, ICU])).toBe(true);
    expect(canViewLocationSchedule(staffMultiMembership, MED, [ER, ICU])).toBe(false);
  });

  it("defaults to zero memberships when the caller omits the list", () => {
    expect(canViewLocationSchedule(staffOneMembership, ER)).toBe(false);
  });
});

describe("canViewLocationSchedule - unknown role", () => {
  it("fails closed for a role the switch doesn't recognize", () => {
    const unknown = { id: "x", role: "SOMETHING_ELSE", clerkDepartmentId: null } as unknown as Actor;
    expect(canViewLocationSchedule(unknown, ER)).toBe(false);
  });
});

describe("locationScheduleShiftWhere", () => {
  it("scopes to the department, the date range, and only assigned shifts", () => {
    const gte = new Date("2026-08-10T00:00:00Z");
    const lt = new Date("2026-08-17T00:00:00Z");
    expect(locationScheduleShiftWhere(ER, { gte, lt })).toEqual({
      departmentId: ER,
      startsAt: { gte, lt },
      assignedWorkerId: { not: null },
    });
  });

  it("produces a filter distinct per department", () => {
    const range = { gte: new Date("2026-08-10T00:00:00Z"), lt: new Date("2026-08-17T00:00:00Z") };
    expect(locationScheduleShiftWhere(ER, range).departmentId).toBe(ER);
    expect(locationScheduleShiftWhere(ICU, range).departmentId).toBe(ICU);
  });
});
