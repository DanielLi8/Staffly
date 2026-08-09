"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { sendVerificationCode, checkVerificationCode } from "@/lib/outreach/verify";
import { isVerifyConfigured } from "@/lib/outreach/twilio";

// E.164: a leading + and 7-15 digits. Outreach requires this format to dial/text.
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, "Enter a phone number in international format, e.g. +14165551234");

export type VerificationActionResult =
  | { status: "sent" }
  | { status: "verified" }
  | { status: "incorrect" }
  | { status: "unavailable" }
  | { status: "error"; message: string };

/** Persist the worker's phone (resetting any prior verification) and send an OTP. */
export async function startPhoneVerification(rawPhone: string): Promise<VerificationActionResult> {
  const session = await requireAuth();

  const parsed = phoneSchema.safeParse(rawPhone);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid phone number" };
  }
  const phone = parsed.data;

  // Changing the number invalidates any previous verification.
  await db.user.update({
    where: { id: session.user.id },
    data: { phone, phoneVerifiedAt: null },
  });

  const result = await sendVerificationCode(phone);
  if (!result.ok) {
    return result.reason === "UNAVAILABLE"
      ? { status: "unavailable" }
      : { status: "error", message: "Could not send a verification code. Try again." };
  }
  return { status: "sent" };
}

/** Check the OTP and, on success, stamp phoneVerifiedAt so outreach may use it. */
export async function confirmPhoneVerification(
  rawPhone: string,
  code: string
): Promise<VerificationActionResult> {
  const session = await requireAuth();

  const parsed = phoneSchema.safeParse(rawPhone);
  if (!parsed.success) {
    return { status: "error", message: "Invalid phone number" };
  }
  const phone = parsed.data;
  const trimmedCode = code.trim();
  if (!/^\d{4,10}$/.test(trimmedCode)) {
    return { status: "error", message: "Enter the numeric code we sent you." };
  }

  const result = await checkVerificationCode(phone, trimmedCode);
  if (!result.ok) {
    return result.reason === "UNAVAILABLE"
      ? { status: "unavailable" }
      : { status: "error", message: "Could not verify the code. Try again." };
  }
  if (!result.approved) {
    return { status: "incorrect" };
  }

  await db.user.update({
    where: { id: session.user.id },
    data: { phone, phoneVerifiedAt: new Date() },
  });
  revalidatePath("/profile");
  return { status: "verified" };
}

/** Whether phone verification is available in this deployment (Twilio Verify set). */
export async function phoneVerificationAvailable(): Promise<boolean> {
  return isVerifyConfigured();
}
