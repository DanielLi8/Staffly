/**
 * The roles a unit's staffing is counted in (decision `role-set-and-lead`):
 * RN, RPN and PSW. PSW is the Ontario term for a health care aide.
 *
 * PURE. Maps a free-text position or `Shift.roleNeeded` label onto a counting
 * role; anything else (CNA, RT, MD, a blank position) is not counted and maps
 * to null. Those people stay schedulable through callouts - this only decides
 * which headcount column they land in.
 *
 * A Team Lead (Lead RN) is NOT a role: it is `User.isTeamLead`, a tag on an
 * RN, so it never appears here and a Team Lead counts as an RN by their
 * `position`. Role ELIGIBILITY (may this person fill this shift) is a separate
 * question answered by `positionMatchesRole` (`src/lib/shifts/role-match.ts`).
 */
import { normalizeRoleLabel } from "@/lib/shifts/role-match";

export const STAFFING_ROLES = ["RN", "RPN", "PSW"] as const;

export type StaffingRole = (typeof STAFFING_ROLES)[number];

export const STAFFING_ROLE_LABELS: Record<StaffingRole, string> = {
  RN: "Registered Nurse",
  RPN: "Registered Practical Nurse",
  PSW: "Personal Support Worker",
};

const ALIASES: Record<string, StaffingRole> = {
  "registered nurse": "RN",
  rn: "RN",
  "registered practical nurse": "RPN",
  rpn: "RPN",
  "personal support worker": "PSW",
  psw: "PSW",
  "health care aide": "PSW",
  "healthcare aide": "PSW",
  hca: "PSW",
};

/**
 * The counting role for a position or role label, or null when it is not one
 * of RN / RPN / PSW (or blank). Case, spacing and a trailing "(RN)"-style
 * abbreviation are ignored, like `positionMatchesRole`.
 */
export function staffingRoleOf(label: string | null | undefined): StaffingRole | null {
  if (!label) return null;
  return ALIASES[normalizeRoleLabel(label)] ?? null;
}
