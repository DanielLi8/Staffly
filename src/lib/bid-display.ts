import type { BidStatus } from "@prisma/client";
import type { Shift } from "@prisma/client";

export type BidUiStatus = "pending" | "assigned" | "completed" | "not_selected";

export function getBidUiStatus(bidStatus: BidStatus, shift: Pick<Shift, "endsAt" | "status">): BidUiStatus {
  if (bidStatus === "NOT_SELECTED") return "not_selected";
  if (bidStatus === "PENDING") return "pending";
  if (bidStatus === "SELECTED") {
    if (new Date(shift.endsAt) < new Date()) return "completed";
    return "assigned";
  }
  return "pending";
}
