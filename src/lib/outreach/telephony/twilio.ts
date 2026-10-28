/**
 * Twilio behind the {@link TelephonyProvider} seam: Programmable Messaging for
 * SMS, `X-Twilio-Signature` for webhooks, TwiML for SMS replies and Twilio
 * Verify for phone OTP. Credentials, the SDK client and signature checking stay
 * in ../twilio.ts (the only reader of `TWILIO_AUTH_TOKEN`).
 */
import twilioSdk from "twilio";
import { getTwilioClient, isVerifyConfigured, twilioConfig } from "../twilio";
import { readVerifiedTwilioForm } from "../webhook";
import { mapTwilioStatus } from "../status";
import type { TelephonyProvider } from "./types";

const MessagingResponse = twilioSdk.twiml.MessagingResponse;

export const twilioProvider: TelephonyProvider = {
  name: "twilio",

  async sendSms({ to, body, statusCallbackUrl }) {
    const client = getTwilioClient();
    const { fromNumber } = twilioConfig();
    if (!client || !fromNumber) {
      console.warn("[outreach:sms] Twilio not configured - skipping SMS send.");
      return { status: "SKIPPED" };
    }

    try {
      const message = await client.messages.create({
        to,
        from: fromNumber,
        body,
        statusCallback: statusCallbackUrl,
      });
      return { status: "SENT", providerMessageId: message.sid };
    } catch (err) {
      console.error("[outreach:sms] Send failed:", err);
      return { status: "FAILED" };
    }
  },

  verifyWebhook: readVerifiedTwilioForm,

  normalizeStatus(params) {
    const providerMessageId = params.MessageSid || params.CallSid || params.SmsSid;
    const status = mapTwilioStatus(params.MessageStatus || params.CallStatus || params.SmsStatus);
    return providerMessageId && status ? { providerMessageId, status } : null;
  },

  parseInboundSms(params) {
    return { from: params.From ?? null, body: params.Body ?? null };
  },

  smsReplyResponse(body) {
    const response = new MessagingResponse();
    if (body) response.message(body);
    return new Response(response.toString(), {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  },

  isOtpConfigured: isVerifyConfigured,

  async sendOtp(phone) {
    const client = getTwilioClient();
    const { verifyServiceSid } = twilioConfig();
    if (!isVerifyConfigured() || !client || !verifyServiceSid) {
      console.warn("[verify] Twilio Verify not configured - cannot send OTP.");
      return { ok: false, reason: "UNAVAILABLE" };
    }
    try {
      await client.verify.v2
        .services(verifyServiceSid)
        .verifications.create({ to: phone, channel: "sms" });
      return { ok: true };
    } catch (err) {
      console.error("[verify] Failed to send code:", err);
      return { ok: false, reason: "ERROR" };
    }
  },

  async checkOtp(phone, code) {
    const client = getTwilioClient();
    const { verifyServiceSid } = twilioConfig();
    if (!isVerifyConfigured() || !client || !verifyServiceSid) {
      console.warn("[verify] Twilio Verify not configured - cannot check OTP.");
      return { ok: false, reason: "UNAVAILABLE" };
    }
    try {
      const check = await client.verify.v2
        .services(verifyServiceSid)
        .verificationChecks.create({ to: phone, code });
      return { ok: true, approved: check.status === "approved" };
    } catch (err) {
      console.error("[verify] Failed to check code:", err);
      return { ok: false, reason: "ERROR" };
    }
  },
};
