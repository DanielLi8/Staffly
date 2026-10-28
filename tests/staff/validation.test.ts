import { describe, it, expect } from "vitest";
import {
  POSITIONS,
  ROLE_NEEDED_OPTIONS,
  findPosition,
  isCanonicalPosition,
  roleNeededLabel,
} from "@/lib/staff/positions";
import { positionMatchesRole } from "@/lib/shifts/role-match";
import {
  STAFF_MESSAGES,
  formatDateOnly,
  parseDateOnly,
  validateStaffInput,
  type StaffFormInput,
} from "@/lib/staff/validation";
import { DEPARTMENT_MESSAGES, validateDepartmentInput } from "@/lib/departments/validation";
import { staffStatus } from "@/lib/staff/accounts";

function input(overrides: Partial<StaffFormInput> = {}): StaffFormInput {
  return {
    name: "Jordan Lee",
    email: "jordan.lee@hospital.ca",
    employeeId: "",
    position: "Registered Practical Nurse",
    primaryDepartmentId: "",
    hireDate: "",
    seniorityRank: "",
    phone: "",
    phoneConfirmed: false,
    isTeamLead: false,
    memberships: [],
    ...overrides,
  };
}

describe("canonical positions", () => {
  it("is exactly the captain's list, in order", () => {
    expect(POSITIONS.map((p) => p.code)).toEqual(["RN", "RPN", "PSW", "CNA", "RT", "MD"]);
  });

  it("every staff position matches the shift role posted for it, and no other", () => {
    for (const p of POSITIONS) {
      for (const role of ROLE_NEEDED_OPTIONS) {
        expect(positionMatchesRole(p.label, role)).toBe(role === roleNeededLabel(p));
      }
    }
  });

  it("recognises canonical labels only", () => {
    expect(isCanonicalPosition("Registered Nurse")).toBe(true);
    expect(isCanonicalPosition("Registered Nurse (RN)")).toBe(false);
    expect(isCanonicalPosition("Nurse")).toBe(false);
    expect(isCanonicalPosition(null)).toBe(false);
  });

  it("resolves labels, role labels and codes to a position", () => {
    expect(findPosition("registered nurse")?.code).toBe("RN");
    expect(findPosition("Physician (MD)")?.code).toBe("MD");
    expect(findPosition("psw")?.code).toBe("PSW");
    expect(findPosition("Staffing Coordinator")).toBeNull();
  });
});

describe("validateStaffInput", () => {
  it("normalizes a valid record", () => {
    const result = validateStaffInput(
      input({
        name: "  Jordan   Lee ",
        email: " Jordan.Lee@Hospital.CA ",
        employeeId: " E-104 ",
        hireDate: "2026-11-02",
        seniorityRank: "12",
        phone: "+1 (416) 555-0199",
        phoneConfirmed: true,
        memberships: [
          { departmentId: "d1", title: " Float  RPN " },
          { departmentId: "d2", title: "RPN" },
        ],
        primaryDepartmentId: "d2",
      }),
      { requireEmail: true }
    );
    expect(result).toEqual({
      ok: true,
      record: {
        name: "Jordan Lee",
        email: "jordan.lee@hospital.ca",
        employeeId: "E-104",
        position: "Registered Practical Nurse",
        primaryDepartmentId: "d2",
        hireDate: new Date(Date.UTC(2026, 10, 2)),
        seniorityRank: 12,
        phone: "+14165550199",
        phoneConfirmed: true,
        isTeamLead: false,
        memberships: [
          { departmentId: "d1", title: "Float RPN" },
          { departmentId: "d2", title: "RPN" },
        ],
      },
    });
  });

  it("returns every field error at once", () => {
    const result = validateStaffInput(
      input({
        name: " ",
        email: "not-an-email",
        position: "Nurse",
        hireDate: "2026-02-30",
        seniorityRank: "0",
        phone: "4165550199",
        memberships: [{ departmentId: "d1", title: "" }],
      }),
      { requireEmail: true }
    );
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        name: STAFF_MESSAGES.nameRequired,
        email: STAFF_MESSAGES.emailInvalid,
        position: STAFF_MESSAGES.positionRequired,
        hireDate: STAFF_MESSAGES.hireDateInvalid,
        seniorityRank: STAFF_MESSAGES.seniorityInvalid,
        phone: STAFF_MESSAGES.phoneInvalid,
        memberships: STAFF_MESSAGES.membershipTitleRequired,
      },
    });
  });

  it("refuses the same department twice", () => {
    const result = validateStaffInput(
      input({ memberships: [{ departmentId: "d1", title: "RN" }, { departmentId: "d1", title: "Lead RN" }] }),
      { requireEmail: false }
    );
    expect(result).toEqual({ ok: false, fieldErrors: { memberships: STAFF_MESSAGES.membershipDuplicate } });
  });

  it("ignores email on edit, and never confirms a missing phone", () => {
    const result = validateStaffInput(input({ email: "", phone: " ", phoneConfirmed: true }), { requireEmail: false });
    expect(result.ok && result.record).toMatchObject({ email: null, phone: null, phoneConfirmed: false });
  });

  it("falls back to the first membership when the main department was removed", () => {
    const result = validateStaffInput(
      input({ primaryDepartmentId: "gone", memberships: [{ departmentId: "d3", title: "RN" }] }),
      { requireEmail: false }
    );
    expect(result.ok && result.record.primaryDepartmentId).toBe("d3");
    const none = validateStaffInput(input({ primaryDepartmentId: "gone" }), { requireEmail: false });
    expect(none.ok && none.record.primaryDepartmentId).toBeNull();
  });

  it("round-trips date-only values", () => {
    expect(formatDateOnly(parseDateOnly("2016-06-01"))).toBe("2016-06-01");
    expect(parseDateOnly("06/01/2016")).toBeNull();
    expect(formatDateOnly(null)).toBe("");
  });
});

describe("validateDepartmentInput", () => {
  const icons = ["star", "heart"];

  it("uppercases the code and trims the rest", () => {
    expect(validateDepartmentInput({ name: " Oncology ", code: "onc", wing: " ", iconKey: "heart" }, icons)).toEqual({
      ok: true,
      record: { name: "Oncology", code: "ONC", wing: null, iconKey: "heart" },
    });
  });

  it("refuses a bad code, empty name and unknown icon", () => {
    expect(validateDepartmentInput({ name: "", code: "E", wing: "", iconKey: "rocket" }, icons)).toEqual({
      ok: false,
      fieldErrors: {
        name: DEPARTMENT_MESSAGES.nameRequired,
        code: DEPARTMENT_MESSAGES.codeInvalid,
        iconKey: DEPARTMENT_MESSAGES.iconInvalid,
      },
    });
  });
});

describe("staffStatus", () => {
  it("deactivation wins, then a missing password is pending", () => {
    expect(staffStatus({ deactivatedAt: new Date(), hasPassword: true })).toBe("DEACTIVATED");
    expect(staffStatus({ deactivatedAt: null, hasPassword: false })).toBe("PENDING");
    expect(staffStatus({ deactivatedAt: null, hasPassword: true })).toBe("ACTIVE");
  });
});
