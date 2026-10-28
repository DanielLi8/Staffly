import { Channel } from "@prisma/client";
import { getTelephonyProvider } from "./telephony";
import { statusCallbackUrl } from "./urls";
import { smsBody } from "./messages";
import type { OutreachChannel, OutreachContext } from "./types";

/**
 * SMS channel, sent through the selected telephony provider (./telephony).
 * Applicable only to a recipient with a VERIFIED phone number. Without provider
 * credentials the send is skipped (logged, no throw) and the attempt is
 * recorded QUEUED - the demo keeps working.
 */
export const smsChannel: OutreachChannel = {
  channel: Channel.SMS,
  isApplicable({ recipient }: OutreachContext) {
    return Boolean(recipient.phone && recipient.phoneVerifiedAt);
  },
  async send({ shift, recipient }: OutreachContext) {
    if (!recipient.phone) {
      return { status: "QUEUED", providerMessageId: null, skipped: true };
    }

    const result = await getTelephonyProvider().sendSms({
      to: recipient.phone,
      body: smsBody(shift),
      statusCallbackUrl: statusCallbackUrl(),
    });
    switch (result.status) {
      case "SKIPPED":
        return { status: "QUEUED", providerMessageId: null, skipped: true };
      case "SENT":
        return { status: "SENT", providerMessageId: result.providerMessageId, skipped: false };
      case "FAILED":
        return { status: "FAILED", providerMessageId: null, skipped: false };
    }
  },
};
