/**
 * Multi-channel outreach dispatcher. Replaces the old "email every worker"
 * blast: given a shift, it reaches the eligible staff in that shift's department
 * across in-app, email, SMS, and voice, recording an OutreachAttempt row per
 * attempt. Credential-free channels simply skip (see each channel).
 *
 * This phase is intentionally flat - no tiering, timers, or ordering. That is
 * Phase 4.
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

/** Channel order is cosmetic here (no tiering): in-app + email always fire. */
const CHANNELS: OutreachChannel[] = [inAppChannel, emailChannel, smsChannel, voiceChannel];

/**
 * Run every applicable channel for one recipient and persist an OutreachAttempt
 * per attempt. Channels never throw for missing credentials, but we still guard
 * each send so one channel failing cannot abort the others.
 */
async function dispatchToRecipient(
  shift: OutreachShift,
  recipient: OutreachRecipient
): Promise<void> {
  const ctx: OutreachContext = { shift, recipient, appUrl: APP_URL };

  for (const channel of CHANNELS) {
    if (!channel.isApplicable(ctx)) continue;
    try {
      const result = await channel.send(ctx);
      await db.outreachAttempt.create({
        data: {
          shiftId: shift.id,
          userId: recipient.id,
          channel: channel.channel,
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

/** Dispatch a shift to a known set of recipients. Exposed for testing. */
export async function dispatchOutreach(
  shift: OutreachShift,
  recipients: OutreachRecipient[]
): Promise<void> {
  await Promise.allSettled(recipients.map((r) => dispatchToRecipient(shift, r)));
}

/**
 * Load a shift and its eligible department staff, then dispatch. Eligible staff
 * are STAFF users with a department membership in the shift's department -
 * targeted outreach, not the old all-staff blast.
 */
export async function outreachForNewShift(shiftId: string): Promise<void> {
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
      departmentId: true,
      department: { select: { name: true } },
    },
  });
  if (!shift) return;

  const recipients = await db.user.findMany({
    where: {
      role: "STAFF",
      departmentMemberships: { some: { departmentId: shift.departmentId } },
    },
    select: { id: true, name: true, email: true, phone: true, phoneVerifiedAt: true },
  });

  const outreachShift: OutreachShift = {
    id: shift.id,
    title: shift.title,
    unit: shift.unit,
    roleNeeded: shift.roleNeeded,
    departmentName: shift.department.name,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    smsCode: shift.smsCode,
  };

  await dispatchOutreach(outreachShift, recipients);
}
