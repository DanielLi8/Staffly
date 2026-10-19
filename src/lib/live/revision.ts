import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { LiveTopic } from "./topics";

/**
 * Revisions: short opaque strings that change whenever the data behind a live
 * topic changes. They are DERIVED FROM THE DATA, never bumped by "publish"
 * calls at write sites, so every writer is covered by construction - server
 * actions, the Twilio webhooks, the Inngest engine, a raw `updateMany` - and
 * nobody can forget a hook.
 *
 * Server-only. Authorization happens before this (src/lib/live/topics.ts);
 * these functions assume the caller may see the topic.
 */

/**
 * Everything the admin shift page renders that someone other than the viewing
 * admin can change. Counts catch deletes (a withdrawn bid); max timestamps
 * catch in-place updates (an award, a reply, a delivery callback).
 */
export interface AdminShiftRevisionInputs {
  shiftUpdatedAt: Date;
  campaignUpdatedAt: Date | null;
  bidCount: number;
  bidsUpdatedAt: Date | null;
  attemptCount: number;
  attemptsUpdatedAt: Date | null;
  activityCount: number;
}

/** Hash revision inputs into the opaque string the client compares. Pure. */
export function hashRevision(inputs: Record<string, Date | number | string | null>): string {
  const canonical = Object.keys(inputs)
    .sort()
    .map((key) => {
      const value = inputs[key];
      return `${key}=${value instanceof Date ? value.toISOString() : String(value)}`;
    })
    .join("|");
  return createHash("sha256").update(canonical).digest("base64url").slice(0, 22);
}

/** The admin-shift revision for a set of inputs. Pure, so its sensitivity is unit-tested. */
export function adminShiftRevision(inputs: AdminShiftRevisionInputs): string {
  return hashRevision({ ...inputs });
}

/**
 * Read the admin-shift inputs in ONE statement, every subquery indexed by
 * `shiftId`. Returns null when the shift does not exist.
 */
export async function loadAdminShiftRevisionInputs(
  shiftId: string
): Promise<AdminShiftRevisionInputs | null> {
  const rows = await db.$queryRaw<
    {
      shiftUpdatedAt: Date;
      campaignUpdatedAt: Date | null;
      bidCount: number;
      bidsUpdatedAt: Date | null;
      attemptCount: number;
      attemptsUpdatedAt: Date | null;
      activityCount: number;
    }[]
  >(Prisma.sql`
    SELECT
      s."updatedAt" AS "shiftUpdatedAt",
      (SELECT c."updatedAt" FROM "CalloutCampaign" c WHERE c."shiftId" = s."id") AS "campaignUpdatedAt",
      b."bidCount", b."bidsUpdatedAt",
      a."attemptCount", a."attemptsUpdatedAt",
      (SELECT count(*)::int FROM "ShiftActivity" sa WHERE sa."shiftId" = s."id") AS "activityCount"
    FROM "Shift" s
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS "bidCount", max(sb."updatedAt") AS "bidsUpdatedAt"
      FROM "ShiftBid" sb WHERE sb."shiftId" = s."id"
    ) b
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS "attemptCount", max(oa."updatedAt") AS "attemptsUpdatedAt"
      FROM "OutreachAttempt" oa WHERE oa."shiftId" = s."id"
    ) a
    WHERE s."id" = ${shiftId}
  `);
  return rows[0] ?? null;
}

/**
 * The current revision for `topic`, or null when there is nothing to follow:
 * the shift is gone, or the topic kind has no revision source yet (the worker
 * and list topics are declared in topics.ts for the follow-up that mounts
 * them). The route answers 404 on null, which stops the client polling.
 */
export async function liveRevision(topic: LiveTopic): Promise<string | null> {
  switch (topic.kind) {
    case "admin-shift": {
      const inputs = await loadAdminShiftRevisionInputs(topic.shiftId);
      return inputs ? adminShiftRevision(inputs) : null;
    }
    case "admin-shifts":
    case "worker-shift":
    case "worker-open-shifts":
    case "worker-bids":
      return null;
  }
}
