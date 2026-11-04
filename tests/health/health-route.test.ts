import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryRawMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { $queryRaw: queryRawMock } }));

import { GET } from "@/app/api/health/route";
import { probeDatabase } from "@/lib/health/probe";

/**
 * `/api/health` is public and watched by an EU-hosted uptime vendor, so beyond
 * ok/degraded it must never echo a config value, DB error, host or person.
 */

const TOKEN = "health-token-0123456789";

// Every value here is distinctive so a leak anywhere in the body is detectable.
const PROD_ENV = {
  VERCEL_ENV: "production",
  VERCEL_REGION: "yul1",
  REQUIRED_FUNCTION_REGION: "yul1",
  VERCEL_GIT_COMMIT_SHA: "abc1234def5678abc1234def5678abc1234def56",
  DATABASE_URL: "postgresql://dbuser:hunter2-db-password@db.internal.example:5432/staffly_prod",
  NEXTAUTH_SECRET: "nextauth-secret-value-zzz",
  NEXTAUTH_URL: "https://staffly.hospital.example",
  INNGEST_EVENT_KEY: "inngest-event-key-yyy",
  INNGEST_SIGNING_KEY: "signkey-prod-xxx",
  TWILIO_AUTH_TOKEN: "twilio-auth-token-www",
  RESEND_API_KEY: "re_resend-key-vvv",
  HEALTH_CHECK_TOKEN: TOKEN,
};

const SECRET_VALUES = [
  "hunter2-db-password",
  "dbuser",
  "db.internal.example",
  "staffly_prod",
  PROD_ENV.NEXTAUTH_SECRET,
  "staffly.hospital.example",
  PROD_ENV.INNGEST_EVENT_KEY,
  PROD_ENV.INNGEST_SIGNING_KEY,
  PROD_ENV.TWILIO_AUTH_TOKEN,
  PROD_ENV.RESEND_API_KEY,
  TOKEN,
  // PII that could only arrive through an error message.
  "maria.santos@hospital.example",
  "+14165551234",
];

const savedEnv = { ...process.env };

function setEnv(env: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  // process.env stringifies assignments, so skip undefined rather than store "undefined".
  for (const [key, value] of Object.entries({ NODE_ENV: "test", ...env })) {
    if (value !== undefined) process.env[key] = value;
  }
}

const call = (headers: Record<string, string> = {}) =>
  GET(new Request("http://localhost/api/health", { headers }));

const detailed = () => call({ "X-Health-Token": TOKEN });

beforeEach(() => {
  queryRawMock.mockReset();
  queryRawMock.mockResolvedValue([{ "?column?": 1 }]);
  setEnv(PROD_ENV);
});

afterEach(() => {
  vi.useRealTimers();
  setEnv(savedEnv);
});

describe("GET /api/health", () => {
  it("is ok: 200, no-store, and only the overall status without the token", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("gives the per-check breakdown with the shared-secret header", async () => {
    const res = await detailed();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "ok",
      checks: {
        db: "ok",
        region: { status: "ok", running: "yul1" },
        config: {
          ok: true,
          present: {
            DATABASE_URL: true,
            NEXTAUTH_SECRET: true,
            NEXTAUTH_URL: true,
            INNGEST_EVENT_KEY: true,
            INNGEST_SIGNING_KEY: true,
          },
        },
      },
      version: "abc1234",
    });
    expect(typeof body.checks.dbLatencyMs).toBe("number");
  });

  it.each([
    ["a wrong token", { "X-Health-Token": "nope" }],
    ["an empty token", { "X-Health-Token": "" }],
  ])("ignores %s and returns only the status", async (_label, headers) => {
    expect(await (await call(headers)).json()).toEqual({ status: "ok" });
  });

  it("never gives details when HEALTH_CHECK_TOKEN is unset, even to an empty header", async () => {
    setEnv({ ...PROD_ENV, HEALTH_CHECK_TOKEN: undefined });
    expect(await (await call({ "X-Health-Token": "" })).json()).toEqual({ status: "ok" });
    expect(await (await call({ "X-Health-Token": "undefined" })).json()).toEqual({ status: "ok" });
  });

  it("is degraded (503) when the DB query fails", async () => {
    queryRawMock.mockRejectedValue(new Error("Can't reach database server at `db.internal.example:5432`"));
    const res = await call();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "degraded" });

    const body = await (await detailed()).json();
    expect(body.checks).toMatchObject({ db: "down", dbLatencyMs: null });
  });

  it("is degraded (503) when the DB hangs past the timeout", async () => {
    vi.useFakeTimers();
    queryRawMock.mockReturnValue(new Promise(() => {}));
    const pending = detailed();
    await vi.advanceTimersByTimeAsync(3000);
    const res = await pending;
    expect(res.status).toBe(503);
    expect((await res.json()).checks.db).toBe("down");
  });

  it.each(["NEXTAUTH_SECRET", "DATABASE_URL", "INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"])(
    "is degraded (503) when %s is missing in production",
    async (name) => {
      setEnv({ ...PROD_ENV, [name]: "" });
      const res = await detailed();
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe("degraded");
      expect(body.checks.config.ok).toBe(false);
      expect(body.checks.config.present[name]).toBe(false);
      expect(body.checks.db).toBe("ok");
    },
  );

  it("is degraded when production NEXTAUTH_URL is not https", async () => {
    setEnv({ ...PROD_ENV, NEXTAUTH_URL: "http://staffly.hospital.example" });
    const res = await detailed();
    expect(res.status).toBe(503);
    expect((await res.json()).checks.config.present.NEXTAUTH_URL).toBe(false);
  });

  it("does not require production-only config outside production", async () => {
    setEnv({
      DATABASE_URL: "postgresql://localhost/x",
      NEXTAUTH_SECRET: "s",
      NEXTAUTH_URL: "http://localhost:3000",
      HEALTH_CHECK_TOKEN: TOKEN,
    });
    const res = await detailed();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checks.config.present).not.toHaveProperty("INNGEST_EVENT_KEY");
    expect(body.checks.region).toEqual({ status: "unchecked", running: null });
    expect(body.version).toBeNull();
  });

  it("is degraded when running outside REQUIRED_FUNCTION_REGION (residency guard)", async () => {
    setEnv({ ...PROD_ENV, VERCEL_REGION: "iad1" });
    const res = await detailed();
    expect(res.status).toBe(503);
    expect((await res.json()).checks.region).toEqual({ status: "mismatch", running: "iad1" });
  });

  it("never echoes a region value that isn't a plain region code", async () => {
    setEnv({ ...PROD_ENV, VERCEL_REGION: "<script>hunter2-db-password" });
    const body = await (await detailed()).json();
    expect(body.checks.region).toEqual({ status: "mismatch", running: null });
  });

  it.each([
    ["healthy", () => {}],
    ["DB error carrying a host and PII", () =>
      queryRawMock.mockRejectedValue(
        new Error("connect failed db.internal.example user dbuser maria.santos@hospital.example +14165551234"),
      )],
    ["missing config", () => setEnv({ ...PROD_ENV, NEXTAUTH_URL: "http://staffly.hospital.example" })],
  ])("never puts a secret or PII value in the body (%s)", async (_label, arrange) => {
    arrange();
    for (const res of [await call(), await detailed()]) {
      const text = await res.text();
      for (const value of SECRET_VALUES) expect(text).not.toContain(value);
    }
  });
});

describe("probeDatabase", () => {
  it("swallows the error into a reason code", async () => {
    queryRawMock.mockRejectedValue(new Error("password authentication failed for user dbuser"));
    expect(await probeDatabase()).toEqual({ ok: false, reason: "error" });
  });

  it("times out instead of hanging", async () => {
    vi.useFakeTimers();
    queryRawMock.mockReturnValue(new Promise(() => {}));
    const pending = probeDatabase(50);
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toEqual({ ok: false, reason: "timeout" });
  });
});
