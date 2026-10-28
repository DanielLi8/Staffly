// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Sessions end on the next request (security review F2): the real NextAuth
 * session flow, driven through `getServerSession` with our `authOptions`, over
 * a mocked user table. A token minted for an account that has since been
 * demoted or deactivated must yield no session and clear the cookie.
 */
vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-session-revocation";
  process.env.NEXTAUTH_URL = "http://localhost:3000";
});

const dbMock = vi.hoisted(() => ({ user: { findUnique: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import { getServerSession } from "next-auth";
import { decode } from "next-auth/jwt";
import { authOptions } from "@/lib/auth";
import { issueSessionClaims } from "@/lib/session-policy";

const COOKIE = "next-auth.session-token";
const SECRET = process.env.NEXTAUTH_SECRET!;
const nowSeconds = () => Math.floor(Date.now() / 1000);

type Account = {
  id: string;
  role: "ADMIN" | "STAFF";
  sessionVersion: number;
  deactivatedAt: Date | null;
  name: string;
  email: string;
};

const ADMIN2: Account = {
  id: "admin-2",
  role: "ADMIN",
  sessionVersion: 0,
  deactivatedAt: null,
  name: "Sarah Chen",
  email: "admin2@staffly.com",
};

let account: Account | null;

beforeEach(() => {
  account = { ...ADMIN2 };
  dbMock.user.findUnique.mockReset();
  dbMock.user.findUnique.mockImplementation(async () => account && { ...account });
});

async function mintToken(remember = false): Promise<string> {
  const claims = issueSessionClaims(ADMIN2, remember, nowSeconds());
  return authOptions.jwt!.encode!({ token: { ...claims }, secret: SECRET, maxAge: authOptions.session!.maxAge! });
}

/** One request carrying the session cookie; returns the session and any Set-Cookie headers. */
async function request(token: string) {
  const headers: Record<string, string | string[]> = {};
  const res = {
    getHeader: (name: string) => headers[name.toLowerCase()],
    setHeader: (name: string, value: string | string[]) => {
      headers[name.toLowerCase()] = value;
    },
    setCookie: () => {},
  };
  const req = { headers: { cookie: `${COOKIE}=${token}` }, cookies: { [COOKIE]: token } };
  const session = await getServerSession(req as never, res as never, authOptions);
  const setCookie = headers["set-cookie"];
  return { session, setCookies: ([] as string[]).concat(setCookie ?? []) };
}

describe("session token contents", () => {
  it("holds id, role and sessionVersion only - no name or email", async () => {
    const payload = await decode({ token: await mintToken(), secret: SECRET });
    expect(Object.keys(payload!).sort()).toEqual(["exp", "iat", "id", "jti", "role", "sessionVersion"]);
  });

  it("keeps sign-in's absolute expiry across refreshes: 12 h, or 7 d with remember me", async () => {
    for (const [remember, hours] of [
      [false, 12],
      [true, 7 * 24],
    ] as const) {
      const { session, setCookies } = await request(await mintToken(remember));
      expect(session?.user).toEqual({ id: "admin-2", role: "ADMIN", name: "Sarah Chen", email: "admin2@staffly.com" });
      const refreshed = setCookies.find((c) => c.startsWith(`${COOKIE}=`))!;
      const payload = await decode({ token: refreshed.split(";")[0].slice(COOKIE.length + 1), secret: SECRET });
      const remaining = (payload!.exp as number) - nowSeconds();
      expect(remaining).toBeGreaterThan(hours * 3600 - 60);
      expect(remaining).toBeLessThanOrEqual(hours * 3600);
      expect(payload).not.toHaveProperty("name");
      expect(payload).not.toHaveProperty("email");
    }
  });
});

describe("revocation on the next request", () => {
  it("a demoted admin is rejected and signed out", async () => {
    const token = await mintToken();
    expect((await request(token)).session?.user.role).toBe("ADMIN");

    account = { ...ADMIN2, role: "STAFF" };
    const { session, setCookies } = await request(token);
    expect(session).toBeNull();
    expect(setCookies.some((c) => c.startsWith(`${COOKIE}=;`) || /Max-Age=0|Expires=Thu, 01 Jan 1970/.test(c))).toBe(
      true
    );
  });

  it("a deactivated user is signed out", async () => {
    const token = await mintToken(true);
    account = { ...ADMIN2, deactivatedAt: new Date() };
    expect((await request(token)).session).toBeNull();
  });

  it("bumping sessionVersion signs the user out everywhere", async () => {
    const token = await mintToken();
    account = { ...ADMIN2, sessionVersion: 1 };
    expect((await request(token)).session).toBeNull();
  });

  it("a deleted user is signed out", async () => {
    const token = await mintToken();
    account = null;
    expect((await request(token)).session).toBeNull();
  });

  it("a pre-policy token (name/email, no sessionVersion) is rejected without a DB read", async () => {
    const legacy = await authOptions.jwt!.encode!({
      // The pre-policy shape: no sessionVersion, which the JWT type now requires.
      token: { id: "admin-2", role: "ADMIN", name: "Sarah Chen", email: "admin2@staffly.com", sub: "admin-2" } as never,
      secret: SECRET,
      maxAge: 30 * 24 * 3600,
    });
    expect((await request(legacy)).session).toBeNull();
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("sign-in", () => {
  const authorize = () => {
    const provider = authOptions.providers[0] as unknown as {
      options: { authorize: (c: Record<string, string>, r: unknown) => Promise<unknown> };
    };
    return provider.options.authorize;
  };

  it("refuses a deactivated account with the same generic failure as a bad password", async () => {
    const bcrypt = await import("bcryptjs");
    const password = await bcrypt.hash("admin123", 4);
    dbMock.user.findUnique.mockResolvedValue({ ...ADMIN2, password, deactivatedAt: new Date() });
    const creds = { email: "deactivated-test@staffly.com", password: "admin123", portalRole: "ADMIN" };
    expect(await authorize()(creds, { headers: {} })).toBeNull();

    dbMock.user.findUnique.mockResolvedValue({ ...ADMIN2, password, deactivatedAt: null });
    expect(await authorize()({ ...creds, remember: "true" }, { headers: {} })).toEqual({
      id: "admin-2",
      role: "ADMIN",
      sessionVersion: 0,
      remember: true,
    });
  });
});
