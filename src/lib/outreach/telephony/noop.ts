/**
 * The provider for `TELEPHONY_PROVIDER=none` (and for an unrecognized value):
 * SMS is skipped, phone verification is unavailable, and every webhook is
 * rejected. The app runs on in-app alerts alone, exactly as it does with the
 * Twilio provider and no Twilio credentials.
 */
import type { TelephonyProvider } from "./types";

export const noopProvider: TelephonyProvider = {
  name: "none",

  async sendSms() {
    console.warn("[outreach:sms] No telephony provider - skipping SMS send.");
    return { status: "SKIPPED" };
  },

  // Fail closed: with no provider there is no secret to verify against.
  async verifyWebhook() {
    return null;
  },

  normalizeStatus() {
    return null;
  },

  parseInboundSms() {
    return { from: null, body: null };
  },

  smsReplyResponse() {
    return new Response(null, { status: 204 });
  },

  isOtpConfigured() {
    return false;
  },

  async sendOtp() {
    console.warn("[verify] No telephony provider - cannot send OTP.");
    return { ok: false, reason: "UNAVAILABLE" };
  },

  async checkOtp() {
    console.warn("[verify] No telephony provider - cannot check OTP.");
    return { ok: false, reason: "UNAVAILABLE" };
  },
};
