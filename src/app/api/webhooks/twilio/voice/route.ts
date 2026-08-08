import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readVerifiedTwilioForm } from "@/lib/outreach/webhook";
import { buildIvrTwiml } from "@/lib/outreach/voice";
import { voiceResponseUrl } from "@/lib/outreach/urls";

export const runtime = "nodejs";
// Public, unauthenticated endpoint - trust anchor is the Twilio signature only.

function xml(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

/**
 * IVR entry point. Twilio dials the worker and requests this URL, which carries
 * shiftId + userId (both covered by the signed URL). We read the shift - NO
 * patient detail, only department/role/date/time - and return a <Gather> that
 * offers "press 1 to accept".
 */
export async function POST(request: Request) {
  const params = await readVerifiedTwilioForm(request);
  if (!params) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const url = new URL(request.url);
  const shiftId = url.searchParams.get("shiftId") ?? "";
  const userId = url.searchParams.get("userId") ?? "";

  const shift = shiftId
    ? await db.shift.findUnique({
        where: { id: shiftId },
        select: {
          id: true,
          title: true,
          unit: true,
          roleNeeded: true,
          startsAt: true,
          endsAt: true,
          smsCode: true,
          department: { select: { name: true } },
        },
      })
    : null;

  if (!shift) {
    const { default: twilioSdk } = await import("twilio");
    const response = new twilioSdk.twiml.VoiceResponse();
    response.say("Sorry, this shift is no longer available. Goodbye.");
    return xml(response.toString());
  }

  const twiml = buildIvrTwiml({
    shift: {
      id: shift.id,
      title: shift.title,
      unit: shift.unit,
      roleNeeded: shift.roleNeeded,
      departmentName: shift.department.name,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      smsCode: shift.smsCode,
    },
    shiftId: shift.id,
    userId,
    responseUrl: voiceResponseUrl(shift.id, userId),
  });

  return xml(twiml);
}
