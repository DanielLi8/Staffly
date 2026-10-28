import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTelephonyProvider } from "@/lib/outreach/telephony";
import { parseReply } from "@/lib/outreach/codes";
import { submitBid } from "@/lib/outreach/accept";
import { outstandingSmsCallouts, recordDecline } from "@/lib/outreach/decline";
import { smsReplies } from "@/lib/outreach/messages";

export const runtime = "nodejs";
// Public, unauthenticated endpoint - trust anchor is the provider's webhook
// signature only. /api/webhooks/twilio/inbound-sms is an alias of this route.

/**
 * Inbound SMS: a worker replying to a callout. Verifies the provider signature,
 * resolves the sender's phone → User, and parses the reply: a full/partial
 * accept goes through the single accept path (`submitBid`), a decline through
 * the single decline path (`recordDecline`). Carrier keywords (STOP/START/…)
 * are acknowledged silently - messaging is a mandatory internal channel, so there
 * is no app-level unsubscribe, but we never crash on them. Every reply text
 * comes from `smsReplies` (GSM-7, one segment).
 */
export async function POST(request: Request) {
  const provider = getTelephonyProvider();
  const params = await provider.verifyWebhook(request);
  if (!params) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const { from, body } = provider.parseInboundSms(params);
  const parsed = parseReply(body);
  const reply = (text: string | null) => provider.smsReplyResponse(text);

  // Carrier compliance keywords: acknowledge with no message (the carrier itself
  // manages STOP/START). Never treat these as a shift code.
  if (parsed.kind === "control") {
    return reply(null);
  }

  if (parsed.kind === "unknown") {
    return reply(smsReplies.unknown);
  }

  // Resolve the sender to a verified user.
  const user = from
    ? await db.user.findFirst({
        where: { phone: from, phoneVerifiedAt: { not: null } },
        select: { id: true },
      })
    : null;
  if (!user) {
    return reply(smsReplies.unknownSender);
  }

  const shift = parsed.code
    ? await db.shift.findUnique({
        where: { smsCode: parsed.code },
        select: { id: true, title: true },
      })
    : null;

  if (parsed.kind === "decline") {
    // A bare "NO" - or "NO THANKS", whose second word merely looks like a code -
    // means the worker's one outstanding callout. With several, ask for the code.
    let target = shift;
    if (!target) {
      const outstanding = await outstandingSmsCallouts(user.id);
      if (outstanding.length === 0) {
        return reply(parsed.code ? smsReplies.unknownCode(parsed.code) : smsReplies.declineNothingOpen);
      }
      if (outstanding.length > 1) return reply(smsReplies.declineNeedsCode);
      target = outstanding[0];
    }

    const result = await recordDecline({ shiftId: target.id, workerId: user.id, source: "SMS" });
    if (!result.ok) return reply(smsReplies.closed);
    return reply(smsReplies.declined(target.title));
  }

  if (!shift) {
    return reply(smsReplies.unknownCode(parsed.code));
  }

  const result = await submitBid({
    shiftId: shift.id,
    workerId: user.id,
    scope: parsed.scope,
    source: "SMS",
    note: parsed.scope === "PARTIAL" ? "Offered a partial shift via SMS." : null,
  });

  if (!result.ok) {
    return reply(smsReplies.closed);
  }

  return reply(smsReplies.bidAccepted(shift.title, parsed.scope === "PARTIAL"));
}
