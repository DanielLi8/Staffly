import type { StaffingRole } from "@prisma/client";

/**
 * The roles a staffing target counts (captain decision role-set-and-lead):
 * RN, RPN and PSW. A Lead RN is an RN with the Team Lead tag, never a fourth
 * count. Order is the display order everywhere (editor, coverage report).
 */
export const STAFFING_ROLES: readonly StaffingRole[] = ["RN", "RPN", "PSW"];

export const STAFFING_ROLE_LABEL: Record<StaffingRole, string> = {
  RN: "RN",
  RPN: "RPN",
  PSW: "PSW",
};

/** Long form for headings and screen readers; PSW is Ontario's health care aide. */
export const STAFFING_ROLE_NAME: Record<StaffingRole, string> = {
  RN: "Registered Nurse",
  RPN: "Registered Practical Nurse",
  PSW: "Personal Support Worker (health care aide)",
};

export function isStaffingRole(value: unknown): value is StaffingRole {
  return typeof value === "string" && (STAFFING_ROLES as readonly string[]).includes(value);
}
