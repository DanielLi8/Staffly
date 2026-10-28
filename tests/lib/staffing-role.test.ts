import { describe, it, expect } from "vitest";
import { STAFFING_ROLES, staffingRoleOf } from "@/lib/roles/staffing-role";

describe("staffingRoleOf", () => {
  it("counts RN, RPN and PSW only", () => {
    expect(STAFFING_ROLES).toEqual(["RN", "RPN", "PSW"]);
  });

  it.each([
    ["Registered Nurse", "RN"],
    ["Registered Nurse (RN)", "RN"],
    ["RN", "RN"],
    ["  registered   nurse ", "RN"],
    ["Registered Practical Nurse", "RPN"],
    ["Registered Practical Nurse (RPN)", "RPN"],
    ["RPN", "RPN"],
    ["Personal Support Worker", "PSW"],
    ["PSW", "PSW"],
    ["PSW (health care aide)", "PSW"],
    ["Health Care Aide", "PSW"],
    ["HCA", "PSW"],
  ])("maps %j to %s", (label, role) => {
    expect(staffingRoleOf(label)).toBe(role);
  });

  it.each([
    "Certified Nursing Assistant (CNA)",
    "Respiratory Therapist",
    "Emergency MD",
    "Nurse Manager",
    "Team Lead", // a tag on an RN, never a role
    "Lead RN",
    "",
    null,
    undefined,
  ])("does not count %j", (label) => {
    expect(staffingRoleOf(label)).toBeNull();
  });
});
