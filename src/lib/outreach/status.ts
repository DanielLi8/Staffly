import { DeliveryStatus } from "@prisma/client";

/**
 * Map a raw Twilio message/call status onto our DeliveryStatus enum. Covers both
 * SMS (queued→sent→delivered/failed) and voice (initiated→answered→completed).
 * Returns null for statuses we don't track (so the row is left untouched).
 */
export function mapTwilioStatus(raw: string | undefined | null): DeliveryStatus | null {
  switch ((raw ?? "").toLowerCase()) {
    case "queued":
    case "accepted":
    case "scheduled":
    case "sending":
    case "initiated":
    case "ringing":
      return DeliveryStatus.QUEUED;
    case "sent":
      return DeliveryStatus.SENT;
    case "delivered":
    case "completed":
      return DeliveryStatus.DELIVERED;
    case "in-progress":
    case "answered":
      return DeliveryStatus.ANSWERED;
    case "failed":
    case "undelivered":
    case "busy":
    case "no-answer":
    case "canceled":
      return DeliveryStatus.FAILED;
    default:
      return null;
  }
}
