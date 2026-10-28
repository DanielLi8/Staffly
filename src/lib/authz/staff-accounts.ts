import type { Actor } from "./index";

/**
 * Who may add new hires, deactivate and reactivate staff accounts.
 *
 * Captain decision 2026-10-25: ONLY System Admins may do this. The
 * `SYSTEM_ADMIN` role doesn't exist yet (it arrives with the access-control
 * roles PR), so until then the capability is an explicit allowlist from the
 * `STAFF_ACCOUNT_MANAGERS` env var: comma- or whitespace-separated user ids
 * and/or emails (emails compare case-insensitively). Unset or empty means
 * NOBODY - it fails closed, never open to every ADMIN.
 *
 * This is the single place that decision lives: every page and action asks
 * {@link canManageStaffAccounts}, so the roles PR swaps the body for a role
 * check and nothing else changes. Pure (env is read by the caller-facing
 * default argument only) so it is unit-testable.
 */
export interface StaffAccountActor extends Actor {
  email?: string | null;
}

export const STAFF_ACCOUNT_MANAGERS_ENV = "STAFF_ACCOUNT_MANAGERS";

export function parseStaffAccountManagers(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[\s,]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function canManageStaffAccounts(
  actor: StaffAccountActor,
  allowlist: Set<string> = parseStaffAccountManagers(process.env[STAFF_ACCOUNT_MANAGERS_ENV])
): boolean {
  if (actor.role !== "ADMIN") return false;
  if (allowlist.has(actor.id.toLowerCase())) return true;
  return Boolean(actor.email && allowlist.has(actor.email.toLowerCase()));
}
