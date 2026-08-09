import { NextResponse } from "next/server";
import twilioSdk from "twilio";
import { db } from "@/lib/db";
import { readVerifiedTwilioForm } from "@/lib/outreach/webhook";
import { parseReply } from "@/lib/outreach/codes";
import { submitBid } from "@/lib/outreach/accept";

export const runtime = "nodejs";
// Public, unauthenticated endpoint - trust anchor is the Twilio signature only.

const MessagingResponse = twilioSdk.twiml.MessagingResponse;

function twiml(body: string | null): NextResponse {
  const response = new MessagingResponse();
  if (body) response.message(body);
  return new NextResponse(response.toString(), {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

/**
 * Inbound SMS: a worker replying with a shift reply code. Validates the
 * signature, resolves the sender's phone → User, parses a full/partial code, and
 * records a ShiftBid via the single accept path. Carrier keywords (STOP/START/…)
 * are acknowledged silently - messaging is a mandatory internal channel, so there
 * is no app-level unsubscribe, but we never crash on them.
 */
export async function POST(request: Request) {
  const params = await readVerifiedTwilioForm(request);
  if (!params) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const from = params.From;
  const parsed = parseReply(params.Body);

  // Carrier compliance keywords: acknowledge with no message (the carrier itself
  // manages STOP/START). Never treat these as a shift code.
  if (parsed.kind === "control") {
    return twiml(null);
  }

  if (parsed.kind === "unknown") {
    return twiml(
      "Sorry, we didn't understand that. Reply YES <code> to accept a shift, or open the Staffly app."
    );
  }

  // Resolve the sender to a verified user.
  const user = from
    ? await db.user.findFirst({
        where: { phone: from, phoneVerifiedAt: { not: null } },
        select: { id: true },
      })
    : null;
  if (!user) {
    return twiml("We couldn't match your number to a Staffly account.");
  }

  const shift = await db.shift.findUnique({
    where: { smsCode: parsed.code },
    select: { id: true, title: true },
  });
  if (!shift) {
    return twiml(`Shift code ${parsed.code} wasn't recognized.`);
  }

  const result = await submitBid({
    shiftId: shift.id,
    workerId: user.id,
    scope: parsed.scope,
    source: "SMS",
    note: parsed.scope === "PARTIAL" ? "Offered a partial shift via SMS." : null,
  });

  if (!result.ok) {
    return twiml("That shift is no longer accepting bids. Thanks for responding.");
  }

  const scopeWord = parsed.scope === "PARTIAL" ? "partial-shift " : "";
  return twiml(
    `Thanks! Your ${scopeWord}bid for ${shift.title} is in. The scheduler will confirm.`
  );
}
