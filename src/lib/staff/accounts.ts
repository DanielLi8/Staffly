/** Account-state vocabulary shared by the Staff page and its actions. Pure. */

export const DEACTIVATION_REASONS = ["Resigned", "Retired", "End of contract", "Terminated", "Other"] as const;
export type DeactivationReason = (typeof DEACTIVATION_REASONS)[number];

/**
 * - ACTIVE: can sign in.
 * - PENDING: added by an admin, no password yet (sign-in invites come with the
 *   account-invite flow), so they can't sign in yet.
 * - DEACTIVATED: access removed; history kept.
 */
export type StaffStatus = "ACTIVE" | "PENDING" | "DEACTIVATED";

export const STAFF_STATUS_LABEL: Record<StaffStatus, string> = {
  ACTIVE: "Active",
  PENDING: "Pending",
  DEACTIVATED: "Deactivated",
};

export function staffStatus(user: { deactivatedAt: Date | null; hasPassword: boolean }): StaffStatus {
  if (user.deactivatedAt) return "DEACTIVATED";
  return user.hasPassword ? "ACTIVE" : "PENDING";
}

/** A shift that blocks deactivation until an admin reassigns or cancels it. */
export interface UpcomingShift {
  id: string;
  startsAt: Date;
  endsAt: Date;
  departmentName: string;
}
