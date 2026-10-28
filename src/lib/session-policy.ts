/**
 * Session lifetime + revocation policy (security review F2, captain decision
 * `session-lifetime-policy`): a session lasts 12 hours, or 7 days with
 * "remember me", counted from sign-in and never extended by use. A deactivated
 * user, a changed role or a bumped `User.sessionVersion` ends every live
 * session on its next request.
 *
 * Pure (no DB, no clock) so it is unit-testable; `src/lib/auth.ts` wires it
 * into NextAuth's `jwt` callback, and the auth route handler uses
 * {@link sessionLifetimeSeconds} for the cookie's own expiry.
 *
 * The token carries ONLY `id`, `role` and `sessionVersion` (plus the standard
 * `exp`/`iat`/`jti`) - never a name or email. Vercel runs middleware, which
 * decodes this token, in every region, so it must hold no personal information
 * (go-live plan, data-residency note).
 */
import type { Role } from "@prisma/client";

export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
export const REMEMBER_ME_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function sessionLifetimeSeconds(remember: boolean): number {
  return remember ? REMEMBER_ME_MAX_AGE_SECONDS : SESSION_MAX_AGE_SECONDS;
}

/** Everything a session token holds. `exp` is the absolute end, in epoch seconds. */
export interface SessionClaims {
  id: string;
  role: Role;
  sessionVersion: number;
  exp: number;
}

/** The claims for a fresh sign-in. */
export function issueSessionClaims(
  user: { id: string; role: Role; sessionVersion: number },
  remember: boolean,
  nowSeconds: number
): SessionClaims {
  return {
    id: user.id,
    role: user.role,
    sessionVersion: user.sessionVersion,
    exp: nowSeconds + sessionLifetimeSeconds(remember),
  };
}

/** The account as the database has it now; `null` when the user no longer exists. */
export type SessionUserState = {
  role: Role;
  sessionVersion: number;
  deactivatedAt: Date | null;
} | null;

export type SessionRevocationReason =
  | "MALFORMED"
  | "EXPIRED"
  | "USER_NOT_FOUND"
  | "DEACTIVATED"
  | "ROLE_CHANGED"
  | "SESSION_VERSION_CHANGED";

/**
 * Narrow a decoded token to {@link SessionClaims}, or `null` when any claim is
 * missing - e.g. a token minted before this policy existed, which carried a
 * name and email but no `sessionVersion`. Such a token is rejected (one forced
 * sign-in), never upgraded in place.
 */
export function readSessionClaims(token: Record<string, unknown>): SessionClaims | null {
  const { id, role, sessionVersion, exp } = token;
  if (typeof id !== "string" || !id) return null;
  if (role !== "ADMIN" && role !== "STAFF") return null;
  if (typeof sessionVersion !== "number" || typeof exp !== "number") return null;
  return { id, role, sessionVersion, exp };
}

/**
 * Why this session must end now, or `null` when it is still good. Any change
 * of role ends the session (rather than silently re-scoping it): the user signs
 * in again through the portal that matches their new role.
 */
export function sessionRevocationReason(
  claims: SessionClaims,
  user: SessionUserState,
  nowSeconds: number
): SessionRevocationReason | null {
  if (nowSeconds >= claims.exp) return "EXPIRED";
  if (!user) return "USER_NOT_FOUND";
  if (user.deactivatedAt) return "DEACTIVATED";
  if (user.role !== claims.role) return "ROLE_CHANGED";
  if (user.sessionVersion !== claims.sessionVersion) return "SESSION_VERSION_CHANGED";
  return null;
}

/**
 * Thrown from the `jwt` callback to end a session. NextAuth then clears the
 * session cookie (on `/api/auth/session`) or `getServerSession` returns `null`
 * (pages, server actions, route handlers). The message is only the reason code:
 * it is logged, so it must never carry a name or email.
 */
export class SessionRevokedError extends Error {
  constructor(readonly reason: SessionRevocationReason) {
    super(`Session revoked: ${reason}`);
    this.name = "SessionRevokedError";
  }
}
