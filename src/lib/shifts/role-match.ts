/**
 * Whether a staff member's clinical position qualifies them for a shift's
 * required role. Pure and dependency-free so it can back both callout
 * candidate selection (`src/lib/callout/campaign.ts`) and bid eligibility
 * (`src/lib/outreach/accept.ts`) with one definition of "qualified."
 *
 * `Shift.roleNeeded` and `User.position` are both free-text fields filled in
 * independently (a fixed dropdown for the former - see `ROLES` in
 * `src/features/shifts/shift-form.tsx` - versus whatever was seeded/entered
 * for the latter), so they don't share one vocabulary today: roleNeeded
 * spells out an abbreviation in parentheses ("Registered Nurse (RN)") where
 * position doesn't ("Registered Nurse"). Rather than a hardcoded per-value
 * lookup table, normalization strips that trailing parenthetical plus
 * case/whitespace differences, which resolves the one documented mismatch
 * generally instead of enumerating every pair.
 *
 * A staff member's Lead RN / Team Lead tag (`User.isTeamLead`) never factors
 * into this comparison - it is an orthogonal attribute layered on top of
 * position, not a different position.
 */

/** Strips a trailing " (ABBR)" and normalizes case/whitespace for comparison. */
export function normalizeRoleLabel(label: string): string {
  return label
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Whether `position` qualifies for `roleNeeded`. A missing position fails
 * closed - an unrecorded clinical position is never treated as a match, since
 * this gate exists specifically to stop unqualified staff from being paged or
 * allowed to bid.
 */
export function positionMatchesRole(position: string | null | undefined, roleNeeded: string): boolean {
  if (!position) return false;
  return normalizeRoleLabel(position) === normalizeRoleLabel(roleNeeded);
}
