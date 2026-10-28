import { normalizeRoleLabel } from "@/lib/shifts/role-match";

/**
 * The canonical clinical positions (captain decision 2026-10-15). The ONE list
 * both sides of position matching pick from: an admin sets `User.position` to a
 * `label` on the Staff page, and the shift form posts `Shift.roleNeeded` as
 * `roleNeededLabel(...)` ("Registered Nurse (RN)"). `positionMatchesRole`
 * strips the trailing "(RN)", so the two always compare equal for the same
 * position. Add a position here, never as a free-text value somewhere else.
 */
export const POSITIONS = [
  { code: "RN", label: "Registered Nurse" },
  { code: "RPN", label: "Registered Practical Nurse" },
  { code: "PSW", label: "Personal Support Worker" },
  { code: "CNA", label: "Certified Nursing Assistant" },
  { code: "RT", label: "Respiratory Therapist" },
  { code: "MD", label: "Physician" },
] as const;

export type Position = (typeof POSITIONS)[number];
export type PositionLabel = Position["label"];

/** The `Shift.roleNeeded` spelling of a position, e.g. "Registered Nurse (RN)". */
export function roleNeededLabel(position: Position): string {
  return `${position.label} (${position.code})`;
}

/** Every value the shift form offers (and `createShift` accepts) for `roleNeeded`. */
export const ROLE_NEEDED_OPTIONS: readonly string[] = POSITIONS.map(roleNeededLabel);

export const POSITION_LABELS: readonly string[] = POSITIONS.map((p) => p.label);

/** Whether `value` is exactly one of the canonical `User.position` labels. */
export function isCanonicalPosition(value: string | null | undefined): value is PositionLabel {
  return value != null && POSITION_LABELS.includes(value);
}

/**
 * The canonical position a free-text value means, if any - "registered nurse",
 * "Registered Nurse (RN)" and "RN" all resolve to RN. Used to show a short
 * code for whatever is stored, including legacy seed values.
 */
export function findPosition(value: string | null | undefined): Position | null {
  if (!value) return null;
  const normalized = normalizeRoleLabel(value);
  return (
    POSITIONS.find(
      (p) => normalizeRoleLabel(p.label) === normalized || p.code.toLowerCase() === normalized
    ) ?? null
  );
}
