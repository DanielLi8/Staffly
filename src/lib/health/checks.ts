/**
 * Pure policy behind `GET /api/health` (go-live plan sec 4.2). Everything here
 * reads an injected env object and returns statuses and booleans only - never
 * an env value, error message, hostname or row - so whatever the route sends
 * is safe to show an unauthenticated uptime monitor (or its EU-hosted vendor).
 */

export type Env = Record<string, string | undefined>;

export type DbCheck = { ok: true; latencyMs: number } | { ok: false; reason: "error" | "timeout" };

/** The deployment Better Stack pages on: the real production build, not previews or local. */
export function isProductionDeployment(env: Env): boolean {
  return env.VERCEL_ENV === "production";
}

const present = (value: string | undefined) => typeof value === "string" && value.trim() !== "";

function isHttpsUrl(value: string | undefined): boolean {
  if (!present(value)) return false;
  try {
    return new URL(value!).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Config the app cannot run correctly without, as name -> present. Always:
 * the DB URL and NextAuth secret/URL. In production also the Inngest keys
 * (without them the posting delay and timed escalation silently vanish) and an
 * https `NEXTAUTH_URL`. Optional integrations (Twilio, email) are not listed:
 * they no-op by design when unset.
 */
export function configChecks(env: Env): Record<string, boolean> {
  const checks: Record<string, boolean> = {
    DATABASE_URL: present(env.DATABASE_URL),
    NEXTAUTH_SECRET: present(env.NEXTAUTH_SECRET),
    NEXTAUTH_URL: present(env.NEXTAUTH_URL),
  };
  if (isProductionDeployment(env)) {
    checks.NEXTAUTH_URL = isHttpsUrl(env.NEXTAUTH_URL);
    checks.INNGEST_EVENT_KEY = present(env.INNGEST_EVENT_KEY);
    checks.INNGEST_SIGNING_KEY = present(env.INNGEST_SIGNING_KEY);
  }
  return checks;
}

export type RegionCheck = {
  /** `unchecked` when no `REQUIRED_FUNCTION_REGION` is configured. */
  status: "ok" | "mismatch" | "unchecked";
  /** The Vercel region code this function runs in (e.g. `yul1`), null off Vercel. */
  running: string | null;
};

/**
 * Residency guard: when `REQUIRED_FUNCTION_REGION` is set, the function must
 * be running there. Only the region code itself is reported - it is a public
 * Vercel identifier, not a secret.
 */
export function regionCheck(env: Env): RegionCheck {
  const raw = env.VERCEL_REGION?.trim() ?? "";
  const required = env.REQUIRED_FUNCTION_REGION?.trim() ?? "";
  const running = isRegionCode(raw) ? raw : null;
  if (!required) return { status: "unchecked", running };
  return { status: raw === required ? "ok" : "mismatch", running };
}

/** Vercel region codes are three letters + a digit (`yul1`, `iad1`); echo nothing else. */
const isRegionCode = (value: string) => /^[a-z]{3}\d$/.test(value);

export type HealthReport = {
  status: "ok" | "degraded";
  checks: {
    db: "ok" | "down";
    dbLatencyMs: number | null;
    region: RegionCheck;
    config: { ok: boolean; present: Record<string, boolean> };
  };
  version: string | null;
};

/** Short commit sha of the running build, when Vercel provides one. */
function version(env: Env): string | null {
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  return present(sha) && /^[0-9a-f]{7,40}$/i.test(sha!) ? sha!.slice(0, 7) : null;
}

export function buildHealthReport(env: Env, db: DbCheck): HealthReport {
  const config = configChecks(env);
  const configOk = Object.values(config).every(Boolean);
  const region = regionCheck(env);
  const ok = db.ok && configOk && region.status !== "mismatch";
  return {
    status: ok ? "ok" : "degraded",
    checks: {
      db: db.ok ? "ok" : "down",
      dbLatencyMs: db.ok ? db.latencyMs : null,
      region,
      config: { ok: configOk, present: config },
    },
    version: version(env),
  };
}
