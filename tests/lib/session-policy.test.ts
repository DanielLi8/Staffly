import { describe, it, expect } from "vitest";
import {
  REMEMBER_ME_MAX_AGE_SECONDS,
  SESSION_MAX_AGE_SECONDS,
  issueSessionClaims,
  readSessionClaims,
  sessionLifetimeSeconds,
  sessionRevocationReason,
  type SessionUserState,
} from "@/lib/session-policy";

const NOW = 1_800_000_000;
const HOUR = 60 * 60;
const USER = { id: "u1", role: "STAFF" as const, sessionVersion: 3 };
const ACTIVE: SessionUserState = { role: "STAFF", sessionVersion: 3, deactivatedAt: null };

describe("session lifetime", () => {
  it("is 12 hours by default and 7 days with remember me", () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(12 * HOUR);
    expect(REMEMBER_ME_MAX_AGE_SECONDS).toBe(7 * 24 * HOUR);
    expect(sessionLifetimeSeconds(false)).toBe(12 * HOUR);
    expect(sessionLifetimeSeconds(true)).toBe(7 * 24 * HOUR);
  });

  it("issues id, role and sessionVersion only, with an absolute exp", () => {
    expect(issueSessionClaims(USER, false, NOW)).toEqual({ ...USER, exp: NOW + 12 * HOUR });
    expect(issueSessionClaims(USER, true, NOW)).toEqual({ ...USER, exp: NOW + 7 * 24 * HOUR });
  });

  it("a 12 h session is over at 12 h; a 7 d session is still good then and over at 7 d", () => {
    const short = issueSessionClaims(USER, false, NOW);
    const long = issueSessionClaims(USER, true, NOW);
    expect(sessionRevocationReason(short, ACTIVE, NOW + 12 * HOUR - 1)).toBeNull();
    expect(sessionRevocationReason(short, ACTIVE, NOW + 12 * HOUR)).toBe("EXPIRED");
    expect(sessionRevocationReason(long, ACTIVE, NOW + 12 * HOUR)).toBeNull();
    expect(sessionRevocationReason(long, ACTIVE, NOW + 7 * 24 * HOUR - 1)).toBeNull();
    expect(sessionRevocationReason(long, ACTIVE, NOW + 7 * 24 * HOUR)).toBe("EXPIRED");
  });
});

describe("sessionRevocationReason", () => {
  const claims = issueSessionClaims(USER, false, NOW);

  it("keeps a session whose account is unchanged", () => {
    expect(sessionRevocationReason(claims, ACTIVE, NOW + 1)).toBeNull();
  });

  it("ends it when the account is deactivated, demoted/promoted, re-versioned or gone", () => {
    expect(sessionRevocationReason(claims, { ...ACTIVE, deactivatedAt: new Date() }, NOW)).toBe("DEACTIVATED");
    expect(sessionRevocationReason(claims, { ...ACTIVE, role: "ADMIN" }, NOW)).toBe("ROLE_CHANGED");
    expect(sessionRevocationReason(claims, { ...ACTIVE, sessionVersion: 4 }, NOW)).toBe("SESSION_VERSION_CHANGED");
    expect(sessionRevocationReason(claims, null, NOW)).toBe("USER_NOT_FOUND");
  });
});

describe("readSessionClaims", () => {
  it("accepts a current token", () => {
    expect(readSessionClaims({ ...USER, exp: NOW, iat: NOW, jti: "x" })).toEqual({ ...USER, exp: NOW });
  });

  it("rejects a pre-policy token (name/email, no sessionVersion)", () => {
    expect(
      readSessionClaims({ id: "u1", role: "STAFF", name: "Maria", email: "m@example.com", sub: "u1", exp: NOW })
    ).toBeNull();
  });

  it("rejects an unknown role or missing id", () => {
    expect(readSessionClaims({ ...USER, role: "UNIT_CLERK", exp: NOW })).toBeNull();
    expect(readSessionClaims({ ...USER, id: "", exp: NOW })).toBeNull();
  });
});
