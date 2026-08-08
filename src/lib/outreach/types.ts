import type { Channel, DeliveryStatus } from "@prisma/client";

/**
 * Channel abstraction for multi-channel outreach. Each concrete channel
 * (sms/voice/email/inapp) implements {@link OutreachChannel}. The dispatcher
 * (index.ts) runs every applicable channel for every recipient and records an
 * OutreachAttempt row per attempt.
 *
 * NB: the interface is named `OutreachChannel` to avoid colliding with the
 * Prisma `Channel` enum, which names the same concept at the data layer.
 */

/** The subset of a User needed to address outreach. No auth/session coupling. */
export interface OutreachRecipient {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  phoneVerifiedAt: Date | null;
}

/** The subset of a Shift safe to surface in outreach. NEVER include clinical notes. */
export interface OutreachShift {
  id: string;
  title: string;
  unit: string;
  roleNeeded: string;
  departmentName: string;
  startsAt: Date;
  endsAt: Date;
  smsCode: string | null;
}

export interface OutreachContext {
  shift: OutreachShift;
  recipient: OutreachRecipient;
  appUrl: string;
}

export interface ChannelSendResult {
  /** Resulting delivery status to persist on the OutreachAttempt. */
  status: DeliveryStatus;
  /** Provider id used later to match delivery-status webhooks; null for email/in-app. */
  providerMessageId?: string | null;
  /** True when nothing was dispatched (credentials absent). Row still recorded as QUEUED. */
  skipped: boolean;
}

export interface OutreachChannel {
  /** The Prisma enum value recorded on the OutreachAttempt. */
  channel: Channel;
  /** Whether this channel can address the recipient (e.g. verified phone for SMS/voice). */
  isApplicable(ctx: OutreachContext): boolean;
  /** Dispatch the message. Must never throw for a missing-credentials condition. */
  send(ctx: OutreachContext): Promise<ChannelSendResult>;
}
