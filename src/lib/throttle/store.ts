import { createHash } from "crypto";
import { db } from "@/lib/db";
import { THROTTLE_RETENTION_MS, isOverLimit, type Limit } from "./policy";

/**
 * Postgres-backed event log behind every rate limit (`ThrottleEvent`). Shared
 * by every server instance and survives cold starts - the old in-memory
 * counter gave each Vercel instance its own fresh allowance.
 *
 * Buckets are "<scope>:<sha256 of subject>", so the table holds no email, IP
 * address or phone number.
 */
export function throttleBucket(scope: string, subject: string): string {
  return `${scope}:${createHash("sha256").update(subject).digest("hex")}`;
}

export interface BucketLimit {
  bucket: string;
  limit: Limit;
}

/** Whether any of the given bucket limits has been reached at `now`. */
export async function anyOverLimit(checks: BucketLimit[], now = new Date()): Promise<boolean> {
  const counts = await Promise.all(
    checks.map(({ bucket, limit }) =>
      db.throttleEvent.count({
        where: { bucket, createdAt: { gt: new Date(now.getTime() - limit.windowMs) } },
      })
    )
  );
  return checks.some(({ limit }, i) => isOverLimit(counts[i], limit));
}

/**
 * Record one event in each bucket, and prune events no limit can still see
 * (indexed on `createdAt`, so the delete stays cheap).
 */
export async function recordEvents(buckets: string[], now = new Date()): Promise<void> {
  await db.$transaction([
    db.throttleEvent.createMany({ data: buckets.map((bucket) => ({ bucket, createdAt: now })) }),
    db.throttleEvent.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - THROTTLE_RETENTION_MS) } },
    }),
  ]);
}

export async function clearBuckets(buckets: string[]): Promise<void> {
  await db.throttleEvent.deleteMany({ where: { bucket: { in: buckets } } });
}
