import { isCanonicalPosition } from "./positions";

/**
 * Staff-record rules, kept pure so the Staff editor can block an invalid save
 * with the exact messages the server action returns as typed field errors
 * (never a throw: Next.js masks thrown server-action errors in production).
 * Mirrors `src/lib/shifts/validation.ts`.
 */

export const STAFF_MESSAGES = {
  nameRequired: "Enter their full name",
  nameTooLong: "Keep the name under 100 characters",
  emailRequired: "Enter their work email",
  emailInvalid: "Enter an email like name@hospital.ca",
  emailTaken: "Someone already has this email",
  employeeIdTooLong: "Keep the employee ID under 32 characters",
  employeeIdTaken: "Someone already has this employee ID",
  positionRequired: "Pick a position. Without one, Staffly can't match shifts or callouts to them.",
  hireDateInvalid: "Enter a date like 2026-11-02",
  seniorityInvalid: "Use a whole number from 1 (most senior)",
  phoneInvalid: "Use international format, e.g. +14165551234",
  phoneTaken: "Another person already has this verified number",
  membershipDuplicate: "They're already in this department",
  membershipTitleRequired: "Add a roster title, e.g. RN or Lead RN",
  membershipTitleTooLong: "Keep the roster title under 40 characters",
  membershipUnknownDepartment: "That department no longer exists",
} as const;

export type StaffField =
  | "name"
  | "email"
  | "employeeId"
  | "position"
  | "hireDate"
  | "seniorityRank"
  | "phone"
  | "memberships";

export type StaffFieldErrors = Partial<Record<StaffField, string>>;

export interface MembershipInput {
  departmentId: string;
  title: string;
}

/** The editor's form state, all strings as typed - also the server action's input. */
export interface StaffFormInput {
  name: string;
  /** Only read on create; an existing account's email is its sign-in identity. */
  email?: string;
  employeeId: string;
  position: string;
  /** Which of `memberships` is shown as their department label ("" = none). */
  primaryDepartmentId: string;
  /** `yyyy-MM-dd` or "". */
  hireDate: string;
  seniorityRank: string;
  phone: string;
  /** The admin confirmed the number with the person - enables SMS/voice now. */
  phoneConfirmed: boolean;
  isTeamLead: boolean;
  memberships: MembershipInput[];
}

export interface StaffRecord {
  name: string;
  email: string | null;
  employeeId: string | null;
  position: string;
  primaryDepartmentId: string | null;
  hireDate: Date | null;
  seniorityRank: number | null;
  phone: string | null;
  phoneConfirmed: boolean;
  isTeamLead: boolean;
  memberships: MembershipInput[];
}

export type StaffValidation =
  | { ok: true; record: StaffRecord }
  | { ok: false; fieldErrors: StaffFieldErrors };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// E.164, same rule as the self-service verification at /profile.
const PHONE = /^\+[1-9]\d{6,14}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A `yyyy-MM-dd` calendar date as UTC midnight, or null if it isn't a real date. */
export function parseDateOnly(value: string): Date | null {
  const m = DATE.exec(value);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.getUTCMonth() === Number(m[2]) - 1 && date.getUTCDate() === Number(m[3]) ? date : null;
}

/** The inverse of {@link parseDateOnly}, for seeding the editor. */
export function formatDateOnly(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

export function validateStaffInput(
  input: StaffFormInput,
  { requireEmail }: { requireEmail: boolean }
): StaffValidation {
  const errors: StaffFieldErrors = {};

  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) errors.name = STAFF_MESSAGES.nameRequired;
  else if (name.length > 100) errors.name = STAFF_MESSAGES.nameTooLong;

  let email: string | null = null;
  if (requireEmail) {
    email = (input.email ?? "").trim().toLowerCase();
    if (!email) errors.email = STAFF_MESSAGES.emailRequired;
    else if (email.length > 254 || !EMAIL.test(email)) errors.email = STAFF_MESSAGES.emailInvalid;
  }

  const employeeId = input.employeeId.trim() || null;
  if (employeeId && employeeId.length > 32) errors.employeeId = STAFF_MESSAGES.employeeIdTooLong;

  if (!isCanonicalPosition(input.position)) errors.position = STAFF_MESSAGES.positionRequired;

  let hireDate: Date | null = null;
  if (input.hireDate.trim()) {
    hireDate = parseDateOnly(input.hireDate.trim());
    if (!hireDate) errors.hireDate = STAFF_MESSAGES.hireDateInvalid;
  }

  let seniorityRank: number | null = null;
  const rank = input.seniorityRank.trim();
  if (rank) {
    seniorityRank = /^\d{1,6}$/.test(rank) ? Number(rank) : NaN;
    if (!Number.isInteger(seniorityRank) || seniorityRank < 1) {
      errors.seniorityRank = STAFF_MESSAGES.seniorityInvalid;
    }
  }

  const phone = input.phone.replace(/[\s().-]/g, "") || null;
  if (phone && !PHONE.test(phone)) errors.phone = STAFF_MESSAGES.phoneInvalid;

  const memberships: MembershipInput[] = [];
  const seen = new Set<string>();
  for (const m of input.memberships) {
    const title = m.title.trim().replace(/\s+/g, " ");
    if (seen.has(m.departmentId)) errors.memberships ??= STAFF_MESSAGES.membershipDuplicate;
    else if (!title) errors.memberships ??= STAFF_MESSAGES.membershipTitleRequired;
    else if (title.length > 40) errors.memberships ??= STAFF_MESSAGES.membershipTitleTooLong;
    seen.add(m.departmentId);
    memberships.push({ departmentId: m.departmentId, title });
  }

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };

  // The department label follows a membership; with none chosen (or the chosen
  // one removed) it falls back to the first, or to nothing.
  const primaryDepartmentId =
    memberships.find((m) => m.departmentId === input.primaryDepartmentId)?.departmentId ??
    memberships[0]?.departmentId ??
    null;

  return {
    ok: true,
    record: {
      name,
      email,
      employeeId,
      position: input.position,
      primaryDepartmentId,
      hireDate,
      seniorityRank,
      phone,
      phoneConfirmed: Boolean(phone) && input.phoneConfirmed,
      isTeamLead: input.isTeamLead,
      memberships,
    },
  };
}
