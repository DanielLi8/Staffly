import { NextResponse } from "next/server";
import twilioSdk from "twilio";
import { db } from "@/lib/db";
import { readVerifiedTwilioForm } from "@/lib/outreach/webhook";
import { parseReply } from "@/lib/outreach/codes";
import { submitBid } from "@/lib/outreach/accept";
import { outstandingSmsCallouts, recordDecline } from "@/lib/outreach/decline";
import { smsReplies } from "@/lib/outreach/messages";
import { handleWebhookOnce } from "@/lib/outreach/webhook-dedupe";

export const runtime = "nodejs";
// Public, unauthenticated endpoint - trust anchor is the Twilio signature only.

const MessagingResponse = twilioSdk.twiml.MessagingResponse;

function twiml(body: string | null): string {
  const response = new MessagingResponse();
  if (body) response.message(body);
  return response.toString();
}

/**
 * Inbound SMS: a worker replying to a callout. Validates the signature,
 * resolves the sender's phone → User, and parses the reply: a full/partial
 * accept goes through the single accept path (`submitBid`), a decline through
 * the single decline path (`recordDecline`). Carrier keywords (STOP/START/…)
 * are acknowledged silently - messaging is a mandatory internal channel, so there
 * is no app-level unsubscribe, but we never crash on them. Every reply text
 * comes from `smsReplies` (GSM-7, one segment). A replayed MessageSid gets
 * the first reply back and changes nothing (`handleWebhookOnce`).
 */
export async function POST(request: Request) {
  const params = await readVerifiedTwilioForm(request);
  if (!params) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const key = params.MessageSid ? `sms:${params.MessageSid}` : null;
  const body = await handleWebhookOnce(key, () => handleReply(params));
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

async function handleReply(params: Record<string, string>): Promise<string> {
  const from = params.From;
  const parsed = parseReply(params.Body);

  // Carrier compliance keywords: acknowledge with no message (the carrier itself
  // manages STOP/START). Never treat these as a shift code.
  if (parsed.kind === "control") {
    return twiml(null);
  }

  if (parsed.kind === "unknown") {
    return twiml(smsReplies.unknown);
  }

  // Resolve the sender to a verified user.
  const user = from
    ? await db.user.findFirst({
        where: { phone: from, phoneVerifiedAt: { not: null } },
        select: { id: true },
      })
    : null;
  if (!user) {
    return twiml(smsReplies.unknownSender);
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
        return twiml(parsed.code ? smsReplies.unknownCode(parsed.code) : smsReplies.declineNothingOpen);
      }
      if (outstanding.length > 1) return twiml(smsReplies.declineNeedsCode);
      target = outstanding[0];
    }

    const result = await recordDecline({ shiftId: target.id, workerId: user.id, source: "SMS" });
    if (!result.ok) return twiml(smsReplies.closed);
    return twiml(smsReplies.declined(target.title));
  }

  if (!shift) {
    return twiml(smsReplies.unknownCode(parsed.code));
  }

  const result = await submitBid({
    shiftId: shift.id,
    workerId: user.id,
    scope: parsed.scope,
    source: "SMS",
    note: parsed.scope === "PARTIAL" ? "Offered a partial shift via SMS." : null,
  });

  if (!result.ok) {
    return twiml(smsReplies.closed);
  }

  return twiml(smsReplies.bidAccepted(shift.title, parsed.scope === "PARTIAL"));
}
