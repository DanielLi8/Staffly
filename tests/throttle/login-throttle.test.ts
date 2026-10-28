import { describe, it, expect, vi, beforeEach } from "vitest";
import { createThrottleDb } from "./fake-throttle-db";
import { LOGIN_LIMITS } from "@/lib/throttle/policy";

/**
 * Review finding F7: the failed-login counter was a module-level Map - every
 * server instance (and every cold start) got a fresh allowance, and every new
 * address got five more guesses at the same account. It now lives in the
 * shared database.
 */

const fake = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof createThrottleDb> }));
vi.mock("@/lib/db", () => ({
  get db() {
    return fake.db;
  },
}));

fake.db = createThrottleDb();

/** A fresh copy of the module, as a new serverless instance would load it. */
async function freshInstance() {
  vi.resetModules();
  return import("@/lib/login-throttle");
}

const EMAIL = "worker1@staffly.com";

beforeEach(() => fake.db.reset());

describe("persistent login throttle (F7)", () => {
  it("still throttles after a cold start or on another instance", async () => {
    const a = await freshInstance();
    for (let i = 0; i < LOGIN_LIMITS.accountAndIp.max; i++) {
      expect(await a.isLoginThrottled(EMAIL, "203.0.113.7")).toBe(false);
      await a.recordLoginFailure(EMAIL, "203.0.113.7");
    }
    expect(await a.isLoginThrottled(EMAIL, "203.0.113.7")).toBe(true);

    const b = await freshInstance();
    expect(await b.isLoginThrottled(EMAIL, "203.0.113.7")).toBe(true);
  });

  it("counts an account case-insensitively", async () => {
    const t = await freshInstance();
    for (let i = 0; i < LOGIN_LIMITS.accountAndIp.max; i++) {
      await t.recordLoginFailure(i % 2 ? EMAIL.toUpperCase() : EMAIL, "203.0.113.7");
    }
    expect(await t.isLoginThrottled(" Worker1@Staffly.com ", "203.0.113.7")).toBe(true);
  });

  it("caps one account across many addresses", async () => {
    const t = await freshInstance();
    for (let i = 0; i < LOGIN_LIMITS.account.max; i++) {
      await t.recordLoginFailure(EMAIL, `198.51.100.${i}`);
    }
    // A brand-new address no longer buys fresh guesses.
    expect(await t.isLoginThrottled(EMAIL, "192.0.2.200")).toBe(true);
    expect(await t.isLoginThrottled("worker2@staffly.com", "192.0.2.200")).toBe(false);
  });

  it("caps one address spraying many accounts", async () => {
    const t = await freshInstance();
    for (let i = 0; i < LOGIN_LIMITS.ip.max; i++) {
      await t.recordLoginFailure(`user${i}@staffly.com`, "203.0.113.9");
    }
    expect(await t.isLoginThrottled("someone-new@staffly.com", "203.0.113.9")).toBe(true);
    expect(await t.isLoginThrottled("someone-new@staffly.com", "203.0.113.10")).toBe(false);
  });

  it("lets the window expire, and a success clears the account's failures", async () => {
    const t = await freshInstance();
    const start = new Date("2030-01-01T00:00:00Z");
    for (let i = 0; i < LOGIN_LIMITS.accountAndIp.max; i++) {
      await t.recordLoginFailure(EMAIL, "203.0.113.7", start);
    }
    expect(await t.isLoginThrottled(EMAIL, "203.0.113.7", start)).toBe(true);
    const later = new Date(start.getTime() + LOGIN_LIMITS.accountAndIp.windowMs);
    expect(await t.isLoginThrottled(EMAIL, "203.0.113.7", later)).toBe(false);

    await t.recordLoginFailure(EMAIL, "203.0.113.7", later);
    await t.clearLoginFailures(EMAIL, "203.0.113.7");
    expect(fake.db.rows().every((r) => r.bucket.startsWith("login:ip:"))).toBe(true);
  });

  it("stores no email or address in the table, and prunes old events", async () => {
    const t = await freshInstance();
    await t.recordLoginFailure(EMAIL, "203.0.113.7", new Date("2030-01-01T00:00:00Z"));
    expect(JSON.stringify(fake.db.rows())).not.toMatch(/worker1|203\.0\.113/);
    await t.recordLoginFailure(EMAIL, "203.0.113.7", new Date("2030-01-03T00:00:00Z"));
    expect(fake.db.rows()).toHaveLength(3);
  });
});

describe("sign-in wiring", () => {
  it("rejects even the right password once throttled, and says why", async () => {
    vi.resetModules();
    process.env.NEXTAUTH_SECRET ??= "test-secret";
    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash("worker123", 4);
    (fake.db as unknown as { user: unknown }).user = {
      findUnique: async ({ where }: { where: { email: string } }) =>
        where.email === EMAIL ? { id: "u1", name: "Maria", email: EMAIL, role: "STAFF", password: hash } : null,
    };
    const { authOptions } = await import("@/lib/auth");
    const provider = authOptions.providers[0] as unknown as {
      options: { authorize: (c: Record<string, string>, r: unknown) => Promise<unknown> };
    };
    const authorize = (password: string, ip: string) =>
      provider.options.authorize(
        { email: EMAIL, password, portalRole: "STAFF", remember: "false" },
        { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } }
      );

    for (let i = 0; i < LOGIN_LIMITS.accountAndIp.max; i++) {
      expect(await authorize("wrong", "203.0.113.7")).toBeNull();
    }
    await expect(authorize("worker123", "203.0.113.7")).rejects.toThrow("THROTTLED");
    // The real user on another address still signs in; the guessing address
    // stays throttled.
    expect(await authorize("worker123", "198.51.100.1")).toMatchObject({ id: "u1" });
    await expect(authorize("worker123", "203.0.113.7")).rejects.toThrow("THROTTLED");
  });
});
