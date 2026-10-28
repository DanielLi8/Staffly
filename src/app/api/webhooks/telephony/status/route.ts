import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTelephonyProvider } from "@/lib/outreach/telephony";

export const runtime = "nodejs";
// This is a public, unauthenticated endpoint. It is intentionally excluded from
// the NextAuth middleware matcher; its only trust anchor is the provider's
// webhook signature. /api/webhooks/twilio/status is an alias of this route.

/**
 * Provider delivery-status callback (SMS, and voice while it was on). Verifies
 * the request signature, then advances the matching OutreachAttempt (by
 * providerMessageId) to the mapped delivery status.
 */
export async function POST(request: Request) {
  const provider = getTelephonyProvider();
  const params = await provider.verifyWebhook(request);
  if (!params) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const update = provider.normalizeStatus(params);
  if (update) {
    await db.outreachAttempt.updateMany({
      where: { providerMessageId: update.providerMessageId },
      data: { status: update.status },
    });
  }

  // Providers expect 2xx; the body is ignored.
  return new NextResponse(null, { status: 204 });
}
