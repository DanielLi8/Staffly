import { Channel } from "@prisma/client";
import twilioSdk from "twilio";
import { getTwilioClient, twilioConfig } from "./twilio";
import { voiceWebhookUrl, statusCallbackUrl } from "./urls";
import { voicePrompt } from "./messages";
import type { OutreachChannel, OutreachContext } from "./types";

const VoiceResponse = twilioSdk.twiml.VoiceResponse;

/**
 * Voice channel via Twilio Voice + a TwiML IVR. Applicable only to a recipient
 * with a VERIFIED phone. The outbound call points Twilio at our /voice webhook,
 * carrying shiftId+userId so the key-press response is unambiguously keyed to
 * this shift and worker. Skips cleanly without credentials.
 */
export const voiceChannel: OutreachChannel = {
  channel: Channel.VOICE,
  isApplicable({ recipient }: OutreachContext) {
    return Boolean(recipient.phone && recipient.phoneVerifiedAt);
  },
  async send({ shift, recipient }: OutreachContext) {
    const client = getTwilioClient();
    const { fromNumber } = twilioConfig();
    if (!client || !fromNumber || !recipient.phone) {
      console.warn("[outreach:voice] Twilio not configured — skipping call.");
      return { status: "QUEUED", providerMessageId: null, skipped: true };
    }

    try {
      const call = await client.calls.create({
        to: recipient.phone,
        from: fromNumber,
        url: voiceWebhookUrl(shift.id, recipient.id),
        statusCallback: statusCallbackUrl(),
      });
      return { status: "QUEUED", providerMessageId: call.sid, skipped: false };
    } catch (err) {
      console.error("[outreach:voice] Call failed:", err);
      return { status: "FAILED", providerMessageId: null, skipped: false };
    }
  },
};

/**
 * Build the TwiML the IVR reads when Twilio dials the worker. A <Gather> of one
 * digit posts to /voice-response, preserving shiftId+userId so the accept is
 * bound to the right shift. Shared by the /voice webhook and its tests.
 */
export function buildIvrTwiml(opts: {
  shift: Parameters<typeof voicePrompt>[0];
  shiftId: string;
  userId: string;
  responseUrl: string;
}): string {
  const response = new VoiceResponse();
  const gather = response.gather({
    numDigits: 1,
    action: opts.responseUrl,
    method: "POST",
    timeout: 10,
  });
  gather.say(voicePrompt(opts.shift));
  // If no key is pressed, repeat the message once by re-directing to the same URL.
  response.say("We did not receive a response. Goodbye.");
  return response.toString();
}

export { statusCallbackUrl };
