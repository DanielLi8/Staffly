/**
 * Phone verification (send + check OTP) through the selected telephony
 * provider (./telephony). Credential-optional: without OTP configured these
 * return a typed "unavailable" result so profile setup degrades gracefully
 * instead of crashing.
 */
import { getTelephonyProvider } from "./telephony";
import type { OtpCheckResult, OtpSendResult } from "./telephony";

export type VerifyResult = OtpSendResult;
export type CheckResult = OtpCheckResult;

/** Whether phone verification is possible in this deployment. */
export function isPhoneVerificationConfigured(): boolean {
  return getTelephonyProvider().isOtpConfigured();
}

/** Send an OTP to `phone` via SMS. */
export function sendVerificationCode(phone: string): Promise<VerifyResult> {
  return getTelephonyProvider().sendOtp(phone);
}

/** Check an OTP the worker entered. `approved` is true only on an exact match. */
export function checkVerificationCode(phone: string, code: string): Promise<CheckResult> {
  return getTelephonyProvider().checkOtp(phone, code);
}
