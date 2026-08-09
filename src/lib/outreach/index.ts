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
import { db } from "@/lib/db";
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

/** Key identifying one (recipient, channel) pair within a tier. */
function attemptKey(userId: string, channel: string): string {
  return `${userId}:${channel}`;
}

/**
 * Run every applicable channel for one recipient and persist an OutreachAttempt
 * per attempt. Channels never throw for missing credentials, but we still guard
 * each send so one channel failing cannot abort the others.
 *
 * `alreadyAttempted` carries the (user, channel) pairs this tier has already
 * reached, so re-running a tier - which the cascade does whenever a step is
 * retried - never re-texts or re-calls anybody.
 */
async function dispatchToRecipient(
  shift: OutreachShift,
  recipient: OutreachRecipient,
  tier: number,
  alreadyAttempted: ReadonlySet<string>
): Promise<void> {
  const ctx: OutreachContext = { shift, recipient, appUrl: APP_URL };

  for (const channel of CHANNELS) {
    if (!channel.isApplicable(ctx)) continue;
    if (alreadyAttempted.has(attemptKey(recipient.id, channel.channel))) continue;
    try {
      const result = await channel.send(ctx);
      // Upsert (not create) so a concurrent duplicate loses the race harmlessly
      // rather than throwing on the (shift, tier, user, channel) unique index.
      await db.outreachAttempt.upsert({
        where: {
          shiftId_tier_userId_channel: {
            shiftId: shift.id,
            tier,
            userId: recipient.id,
            channel: channel.channel,
          },
        },
        create: {
          shiftId: shift.id,
          userId: recipient.id,
          channel: channel.channel,
          tier,
          status: result.status,
          providerMessageId: result.providerMessageId ?? null,
        },
        update: {
          status: result.status,
          providerMessageId: result.providerMessageId ?? null,
        },
      });
    } catch (err) {
      // A send/record failure for one channel must not break the others.
      console.error(`[outreach] ${channel.channel} attempt failed:`, err);
    }
  }
}

/**
 * Dispatch a shift to a known set of recipients. Exposed for testing and used by
 * the cascade one tier at a time.
 */
export async function dispatchOutreach(
  shift: OutreachShift,
  recipients: OutreachRecipient[],
  options: DispatchOptions = {}
): Promise<void> {
  const tier = options.tier ?? NO_TIER;
  if (recipients.length === 0) return;

  const existing = await db.outreachAttempt.findMany({
    where: { shiftId: shift.id, tier, userId: { in: recipients.map((r) => r.id) } },
    select: { userId: true, channel: true },
  });
  const alreadyAttempted = new Set(existing.map((a) => attemptKey(a.userId, a.channel)));

  await Promise.allSettled(
    recipients.map((r) => dispatchToRecipient(shift, r, tier, alreadyAttempted))
  );
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
