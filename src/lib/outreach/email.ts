import { Channel } from "@prisma/client";
import { format } from "date-fns";
import { sendEmail, newShiftEmailHtml } from "@/lib/email";
import type { OutreachChannel, OutreachContext } from "./types";

/**
 * Email channel: a thin wrapper over the existing Resend helper. Always
 * applicable (every user has an email). `sendEmail` already no-ops without
 * RESEND_API_KEY, so this never crashes the credential-free demo.
 */
export const emailChannel: OutreachChannel = {
  channel: Channel.EMAIL,
  isApplicable() {
    return true;
  },
  async send({ shift, recipient, appUrl }: OutreachContext) {
    await sendEmail({
      to: recipient.email,
      subject: `New Shift Available – ${shift.title}`,
      html: newShiftEmailHtml({
        workerName: recipient.name,
        shiftTitle: shift.title,
        unit: shift.unit,
        date: format(shift.startsAt, "EEE, MMM d · h:mm a"),
        appUrl,
      }),
    });
    // Resend does not surface a per-message id through our helper; treat as sent.
    return { status: "SENT", providerMessageId: null, skipped: false };
  },
};
