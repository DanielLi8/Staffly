/**
 * Phone verification via Twilio Verify (send + check OTP). Credential-optional:
 * without a Verify service configured these return a typed "unavailable" result
 * so profile setup degrades gracefully instead of crashing.
 */
import { getTwilioClient, twilioConfig, isVerifyConfigured } from "./twilio";

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "UNAVAILABLE" | "ERROR" };

export type CheckResult =
  | { ok: true; approved: boolean }
  | { ok: false; reason: "UNAVAILABLE" | "ERROR" };

/** Send an OTP to `phone` via SMS. */
export async function sendVerificationCode(phone: string): Promise<VerifyResult> {
  const client = getTwilioClient();
  const { verifyServiceSid } = twilioConfig();
  if (!isVerifyConfigured() || !client || !verifyServiceSid) {
    console.warn("[verify] Twilio Verify not configured — cannot send OTP.");
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
}

/** Check an OTP the worker entered. `approved` is true only on an exact match. */
export async function checkVerificationCode(phone: string, code: string): Promise<CheckResult> {
  const client = getTwilioClient();
  const { verifyServiceSid } = twilioConfig();
  if (!isVerifyConfigured() || !client || !verifyServiceSid) {
    console.warn("[verify] Twilio Verify not configured — cannot check OTP.");
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
}
