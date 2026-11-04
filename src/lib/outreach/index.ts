/**
 * Multi-channel outreach dispatcher. Given a shift, it reaches a set of staff
 * across in-app, SMS, and voice (email is currently disabled, see
 * {@link EMAIL_CHANNEL_ENABLED}), recording an OutreachAttempt row per
 * attempt. Credential-free channels simply skip (see each channel).
 *
 * Phase 4 added the `tier` dimension: the escalation cascade dispatches one tier
 * at a time and every attempt is stamped with the tier that produced it. Who
 * belongs in which tier is decided upstream, by the pure targeting module
 * (src/lib/callout/tiers.ts); this file stays a dumb, tier-agnostic pipe.
 */
import type { Channel } from "@prisma/client";
import { db } from "@/lib/db";
import { isCampaignTerminal } from "@/lib/callout/decide";
import { emailChannel } from "./email";
import { inAppChannel } from "./inapp";
import { smsChannel } from "./sms";
import { voiceChannel } from "./voice";
import type { OutreachChannel, OutreachContext, OutreachRecipient, OutreachShift } from "./types";

export type { OutreachChannel, OutreachContext, OutreachRecipient, OutreachShift } from "./types";
export { submitBid } from "./accept";

const APP_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

/**
 * Email is disabled for shift outreach. The channel implementation and its
 * templates are kept intact (src/lib/outreach/email.ts, src/lib/email.ts) so
 * re-enabling is this one-line flip back to `true`. It also drives what the
 * fill dashboard shows, so historical email attempts stay hidden while off.
 */
export const EMAIL_CHANNEL_ENABLED = false;

/** Channel order is cosmetic here (no tiering): in-app always fires. */
const CHANNELS: OutreachChannel[] = [
  inAppChannel,
  ...(EMAIL_CHANNEL_ENABLED ? [emailChannel] : []),
  smsChannel,
  voiceChannel,
];

/** Untiered outreach - a direct dispatch that is not part of a cascade. */
export const NO_TIER = 0;

export interface DispatchOptions {
  /** Cascade tier to stamp on each attempt. Defaults to {@link NO_TIER}. */
  tier?: number;
}

/**
 * Claim the right to send one (shift, tier, user, channel) message, BEFORE
 * sending it. Returns the claimed attempt's id, or null when this caller must
 * not send.
 *
 * 1. Insert the attempt row (QUEUED). The (shift, tier, user, channel) unique
 *    key means exactly one caller wins it - a concurrent advance, a second
 *    engine step or an Inngest retry after a crash all lose - so a message is
 *    sent at most once, never twice.
 * 2. THEN re-read the callout. If it was stopped/filled/exhausted, or the shift
 *    is no longer open, give the claim back and send nothing. Because the check
 *    runs after the insert committed, any claim made after a Stop committed is
 *    guaranteed to see that Stop: once Stop returns, no new message is sent
 *    (one already claimed and in flight at that instant still goes).
 *
 * Untiered outreach (tier 0, outside a campaign) only needs the shift open.
 */
async function claimAttempt(shiftId: string, tier: number, userId: string, channel: Channel): Promise<string | null> {
  // skipDuplicates = ON CONFLICT DO NOTHING: a lost claim is a count of 0, not
  // an error (which Prisma would log on every engine retry).
  const key = { shiftId, tier, userId, channel };
  const { count } = await db.outreachAttempt.createMany({
    data: [{ ...key, status: "QUEUED" }],
    skipDuplicates: true,
  });
  if (count !== 1) return null;
  const { id: attemptId } = await db.outreachAttempt.findUniqueOrThrow({
    where: { shiftId_tier_userId_channel: key },
    select: { id: true },
  });

  const live = await db.shift.findUnique({
    where: { id: shiftId },
    select: { status: true, campaign: { select: { status: true } } },
  });
  const campaignLive = tier === NO_TIER || (live?.campaign != null && !isCampaignTerminal(live.campaign.status));
  if (live?.status === "OPEN" && campaignLive) return attemptId;

  await db.outreachAttempt.delete({ where: { id: attemptId } });
  return null;
}

/**
 * Run every applicable channel for one recipient, claiming each attempt before
 * sending it (see {@link claimAttempt}), then recording the outcome on the
 * claimed row. Channels never throw for missing credentials, but we still guard
 * each send so one channel failing cannot abort the others.
 */
async function dispatchToRecipient(
  shift: OutreachShift,
  recipient: OutreachRecipient,
  tier: number
): Promise<number> {
  const ctx: OutreachContext = { shift, recipient, appUrl: APP_URL };
  let sent = 0;

  for (const channel of CHANNELS) {
    if (!channel.isApplicable(ctx)) continue;
    let attemptId: string | null = null;
    try {
      attemptId = await claimAttempt(shift.id, tier, recipient.id, channel.channel);
      if (!attemptId) continue;
      const result = await channel.send(ctx);
      await db.outreachAttempt.update({
        where: { id: attemptId },
        data: { status: result.status, providerMessageId: result.providerMessageId ?? null },
      });
      sent++;
    } catch (err) {
      // A send/record failure for one channel must not break the others. The
      // claim stays (marked FAILED): retrying could double-send if the provider
      // did accept the message before the error.
      console.error(`[outreach] ${channel.channel} attempt failed:`, err);
      if (attemptId) {
        await db.outreachAttempt
          .update({ where: { id: attemptId }, data: { status: "FAILED" } })
          .catch(() => undefined);
      }
    }
  }
  return sent;
}

/**
 * Dispatch a shift to a known set of recipients. Exposed for testing and used by
 * the cascade one tier at a time. Idempotent per (shift, tier, user, channel)
 * and a no-op once the callout has ended. Resolves to how many messages this
 * call actually sent.
 */
export async function dispatchOutreach(
  shift: OutreachShift,
  recipients: OutreachRecipient[],
  options: DispatchOptions = {}
): Promise<number> {
  const tier = options.tier ?? NO_TIER;
  if (recipients.length === 0) return 0;

  const results = await Promise.allSettled(recipients.map((r) => dispatchToRecipient(shift, r, tier)));
  return results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value : 0), 0);
}

/**
 * Load the outreach-safe projection of a shift. Deliberately a narrow select:
 * clinical `notes` must never reach an SMS or an IVR prompt.
 */
export async function loadOutreachShift(shiftId: string): Promise<OutreachShift | null> {
  const shift = await db.shift.findUnique({
    where: { id: shiftId },
    select: {
      id: true,
      title: true,
      unit: true,
      roleNeeded: true,
      startsAt: true,
      endsAt: true,
      smsCode: true,
      department: { select: { name: true } },
    },
  });
  if (!shift) return null;

  return {
    id: shift.id,
    title: shift.title,
    unit: shift.unit,
    roleNeeded: shift.roleNeeded,
    departmentName: shift.department.name,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    smsCode: shift.smsCode,
  };
}
