import { Channel } from "@prisma/client";
import { getTwilioClient, twilioConfig } from "./twilio";
import { statusCallbackUrl } from "./urls";
import { smsBody } from "./messages";
import type { OutreachChannel, OutreachContext } from "./types";

/**
 * SMS channel via Twilio Programmable Messaging. Applicable only to a recipient
 * with a VERIFIED phone number. Without Twilio credentials the send is skipped
 * (logged, no throw) and the attempt is recorded QUEUED - the demo keeps working.
 */
export const smsChannel: OutreachChannel = {
  channel: Channel.SMS,
  isApplicable({ recipient }: OutreachContext) {
    return Boolean(recipient.phone && recipient.phoneVerifiedAt);
  },
  async send({ shift, recipient }: OutreachContext) {
    const client = getTwilioClient();
    const { fromNumber } = twilioConfig();
    if (!client || !fromNumber || !recipient.phone) {
      console.warn("[outreach:sms] Twilio not configured — skipping SMS send.");
      return { status: "QUEUED", providerMessageId: null, skipped: true };
    }

    try {
      const message = await client.messages.create({
        to: recipient.phone,
        from: fromNumber,
        body: smsBody(shift),
        statusCallback: statusCallbackUrl(),
      });
      return { status: "SENT", providerMessageId: message.sid, skipped: false };
    } catch (err) {
      console.error("[outreach:sms] Send failed:", err);
      return { status: "FAILED", providerMessageId: null, skipped: false };
    }
  },
};
