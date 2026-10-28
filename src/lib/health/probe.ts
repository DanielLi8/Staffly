import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import type { DbCheck } from "./checks";

export const DB_TIMEOUT_MS = 3000;

/**
 * `SELECT 1` against the app's own Prisma client, capped at `timeoutMs` so a
 * hung connection pool answers "down" instead of hanging the monitor. Errors
 * are swallowed into a reason code on purpose: a Prisma message can carry the
 * DB host or user, and nothing from it may reach the response.
 */
export async function probeDatabase(timeoutMs = DB_TIMEOUT_MS): Promise<DbCheck> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DbCheck>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), timeoutMs);
  });
  const query = db.$queryRaw`SELECT 1`.then(
    (): DbCheck => ({ ok: true, latencyMs: Math.round(performance.now() - started) }),
    (): DbCheck => ({ ok: false, reason: "error" }),
  );
  try {
    return await Promise.race([query, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export const HEALTH_TOKEN_HEADER = "x-health-token";

/**
 * True when `provided` matches `HEALTH_CHECK_TOKEN`. With the env var unset the
 * detailed view is off entirely. Compared as SHA-256 digests so the comparison
 * is constant-time regardless of length.
 */
export function isDetailAuthorized(provided: string | null, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
