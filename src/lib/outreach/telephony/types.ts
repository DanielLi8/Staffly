import type { DeliveryStatus } from "@prisma/client";

/**
 * The seam between Staffly's SMS outreach and whichever carrier API sends it.
 * Everything provider-specific (REST calls, webhook signatures, status
 * vocabulary, reply markup, phone OTP) sits behind {@link TelephonyProvider};
 * the channels, webhook routes and profile verification only ever talk to
 * `getTelephonyProvider()` (./index.ts).
 *
 * SMS only: voice/IVR is switched off (VOICE_CHANNEL_ENABLED in
 * src/lib/outreach/index.ts) and its Twilio code stays outside this seam.
 *
 * Every method is credential-optional: with the provider's env vars absent it
 * must no-op (send -> skipped, OTP -> UNAVAILABLE) or fail closed (webhook ->
 * null), never throw.
 */

export type TelephonyProviderName = "twilio" | "none";

export interface SendSmsInput {
  /** E.164 recipient. */
  to: string;
  /** Final GSM-7 text, built only in ../messages.ts. */
  body: string;
  /** Where the provider should post delivery-status updates. */
  statusCallbackUrl: string;
}

export type SendSmsResult =
  /** Nothing left the process (credentials absent). */
  | { status: "SKIPPED" }
  | { status: "SENT"; providerMessageId: string }
  | { status: "FAILED" };

/** A delivery-status webhook, reduced to what an OutreachAttempt needs. */
export interface NormalizedStatus {
  providerMessageId: string;
  status: DeliveryStatus;
}

/** An inbound SMS webhook, reduced to sender + text. */
export interface InboundSms {
  from: string | null;
  body: string | null;
}

export type OtpSendResult =
  | { ok: true }
  | { ok: false; reason: "UNAVAILABLE" | "ERROR" };

export type OtpCheckResult =
  | { ok: true; approved: boolean }
  | { ok: false; reason: "UNAVAILABLE" | "ERROR" };

export interface TelephonyProvider {
  name: TelephonyProviderName;

  sendSms(input: SendSmsInput): Promise<SendSmsResult>;

  /**
   * Authenticate a public webhook request and return its params, or null when
   * the signature is missing/invalid or the provider's secret is unset. This is
   * the security boundary: every webhook route rejects (403) on null BEFORE any
   * DB read or write.
   */
  verifyWebhook(request: Request): Promise<Record<string, string> | null>;

  /** Read a verified delivery-status webhook; null when it carries nothing we track. */
  normalizeStatus(params: Record<string, string>): NormalizedStatus | null;

  /** Read a verified inbound-SMS webhook. */
  parseInboundSms(params: Record<string, string>): InboundSms;

  /** The webhook response that answers an inbound SMS (null = reply with nothing). */
  smsReplyResponse(body: string | null): Response;

  /** Whether phone verification (OTP) is possible in this deployment. */
  isOtpConfigured(): boolean;
  sendOtp(phone: string): Promise<OtpSendResult>;
  checkOtp(phone: string, code: string): Promise<OtpCheckResult>;
}
