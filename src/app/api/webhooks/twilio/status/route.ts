import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readVerifiedTwilioForm } from "@/lib/outreach/webhook";
import { mapTwilioStatus } from "@/lib/outreach/status";

export const runtime = "nodejs";
// This is a public, unauthenticated endpoint. It is intentionally excluded from
// the NextAuth middleware matcher; its only trust anchor is the Twilio signature.

/**
 * Twilio delivery-status callback for both SMS and voice. Validates the request
 * signature, then advances the matching OutreachAttempt (by providerMessageId)
 * to the mapped delivery status.
 */
export async function POST(request: Request) {
  const params = await readVerifiedTwilioForm(request);
  if (!params) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const providerMessageId = params.MessageSid || params.CallSid || params.SmsSid;
  const rawStatus = params.MessageStatus || params.CallStatus || params.SmsStatus;
  const status = mapTwilioStatus(rawStatus);

  if (providerMessageId && status) {
    await db.outreachAttempt.updateMany({
      where: { providerMessageId },
      data: { status },
    });
  }

  // Twilio expects 2xx; the body is ignored.
  return new NextResponse(null, { status: 204 });
}
