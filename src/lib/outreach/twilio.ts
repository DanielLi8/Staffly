/**
 * Credential-optional Twilio access. Mirrors src/lib/email.ts: with no Twilio
 * env vars the app must keep running - client factories return null and callers
 * skip sending. `TWILIO_AUTH_TOKEN` is read here only (server env) and never
 * leaves this module.
 */
import twilioSdk, { validateRequest } from "twilio";
import type { Twilio } from "twilio";

export interface TwilioConfig {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  verifyServiceSid?: string;
}

export function twilioConfig(): TwilioConfig {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID || undefined,
    authToken: process.env.TWILIO_AUTH_TOKEN || undefined,
    fromNumber: process.env.TWILIO_PHONE_NUMBER || undefined,
    verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID || undefined,
  };
}

/** True when SMS/voice sending is possible (account + token + from number). */
export function isTwilioConfigured(): boolean {
  const { accountSid, authToken, fromNumber } = twilioConfig();
  return Boolean(accountSid && authToken && fromNumber);
}

/** True when Twilio Verify (phone OTP) is possible. */
export function isVerifyConfigured(): boolean {
  const { accountSid, authToken, verifyServiceSid } = twilioConfig();
  return Boolean(accountSid && authToken && verifyServiceSid);
}

/**
 * A live Twilio REST client, or null when credentials are absent. Callers MUST
 * handle null (skip + log) so the credential-free demo never crashes.
 */
export function getTwilioClient(): Twilio | null {
  const { accountSid, authToken } = twilioConfig();
  if (!accountSid || !authToken) return null;
  // The SDK constructor throws if the SID is not "AC...": only reached with real creds.
  return twilioSdk(accountSid, authToken);
}

/**
 * Validate an inbound Twilio webhook signature. Returns false (reject) whenever
 * the auth token is unset or the signature is missing/mismatched - fail closed.
 * This is the security boundary for every public webhook: call before any write.
 */
export function isValidTwilioSignature(args: {
  signature: string | null | undefined;
  url: string;
  params: Record<string, string>;
}): boolean {
  const { authToken } = twilioConfig();
  if (!authToken) return false;
  if (!args.signature) return false;
  try {
    return validateRequest(authToken, args.signature, args.url, args.params);
  } catch {
    return false;
  }
}
