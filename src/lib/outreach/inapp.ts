import { Channel } from "@prisma/client";
import { hospitalDateTime } from "@/lib/timezone";
import { db } from "@/lib/db";
import type { OutreachChannel, OutreachContext } from "./types";

/**
 * In-app channel: the existing Notification model. Always applicable and always
 * "delivered" the moment it is written. No external provider, so no message id.
 */
export const inAppChannel: OutreachChannel = {
  channel: Channel.IN_APP,
  isApplicable() {
    return true;
  },
  async send({ shift, recipient }: OutreachContext) {
        const when = hospitalDateTime(shift.startsAt);
    await db.notification.create({
      data: {
        userId: recipient.id,
        type: "NEW_SHIFT",
        title: "New Shift Available",
        message: `A new callout shift (${shift.title}) is available on ${when}.`,
        shiftId: shift.id,
      },
    });
    return { status: "DELIVERED", providerMessageId: null, skipped: false };
  },
};
