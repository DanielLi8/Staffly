import { NextResponse } from "next/server";
import twilioSdk from "twilio";
import { db } from "@/lib/db";
import { readVerifiedTwilioForm } from "@/lib/outreach/webhook";
import { submitBid } from "@/lib/outreach/accept";

export const runtime = "nodejs";
// Public, unauthenticated endpoint - trust anchor is the Twilio signature only.

const VoiceResponse = twilioSdk.twiml.VoiceResponse;

function say(text: string): NextResponse {
  const response = new VoiceResponse();
  response.say(text);
  return new NextResponse(response.toString(), {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

/**
 * IVR key-press handler. The shift and worker are pinned by the signed query
 * params (shiftId + userId), so there is no ambiguity about which shift the
 * digit accepts. Pressing 1 records a ShiftBid via the single accept path and
 * notifies the scheduler; 2 records a decline.
 */
export async function POST(request: Request) {
  const params = await readVerifiedTwilioForm(request);
  if (!params) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const url = new URL(request.url);
  const shiftId = url.searchParams.get("shiftId") ?? "";
  const userId = url.searchParams.get("userId") ?? "";
  const digit = params.Digits ?? "";

  if (!shiftId || !userId) {
    return say("Sorry, something went wrong. Goodbye.");
  }

  if (digit === "1") {
    const result = await submitBid({
      shiftId,
      workerId: userId,
      scope: "FULL",
      source: "VOICE",
    });
    if (!result.ok) {
      return say("That shift is no longer accepting bids. Goodbye.");
    }
    return say("Thank you. Your bid has been recorded. The scheduler will confirm. Goodbye.");
  }

  if (digit === "2") {
    await db.outreachAttempt.updateMany({
      where: { shiftId, userId, channel: "VOICE" },
      data: { response: "DECLINED", respondedAt: new Date() },
    });
    return say("You have declined this shift. Thank you. Goodbye.");
  }

  return say("Sorry, we didn't get a valid response. Goodbye.");
}
