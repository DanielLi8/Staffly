import type { StaffStatus } from "@/lib/staff/accounts";

/** One row of the Staff page list, already shaped server-side (no password hash crosses over). */
export interface StaffRow {
  id: string;
  name: string;
  email: string;
  employeeId: string | null;
  position: string | null;
  isTeamLead: boolean;
  status: StaffStatus;
  memberships: { departmentId: string; code: string; name: string; title: string }[];
}

export interface DepartmentRow {
  id: string;
  name: string;
  code: string;
  wing: string | null;
  iconKey: string;
  memberCount: number;
}

export interface DepartmentChoice {
  id: string;
  name: string;
  code: string;
}
