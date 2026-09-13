/**
 * Pure formatting for the `ShiftActivity` rows an approved Shift Swap /
 * Giveaway writes. PURE: no DB. Mirrors the mockup's audit-trail example
 * verbatim - "Reassigned via Shift Swap: Maria Santos -> Thomas Nguyen -
 * accepted by Thomas, approved by Sarah Chen (Admin)" - with the bold action
 * label ("Reassigned via Shift Swap"/"Reassigned via Shift Giveaway") kept
 * separate from the detail line so `formatActivityAction` on the admin shift
 * detail page can render it the same way as every other activity entry.
 */
import type { ShiftSwapKind } from "@/features/shift-swap/types";

export const SWAP_REASSIGNED_ACTION: Record<ShiftSwapKind, string> = {
  SWAP: "SHIFT_SWAP_REASSIGNED",
  GIVEAWAY: "SHIFT_GIVEAWAY_REASSIGNED",
};

export const SWAP_REASSIGNED_ACTION_LABEL: Record<string, string> = {
  [SWAP_REASSIGNED_ACTION.SWAP]: "Reassigned via Shift Swap",
  [SWAP_REASSIGNED_ACTION.GIVEAWAY]: "Reassigned via Shift Giveaway",
};

/**
 * One shift's half of the story: `fromName` gave it up, `toName` received it.
 * For a SWAP this is called twice (once per shift, with `fromName`/`toName`
 * reversed the second time) since both shifts changed hands; `acceptedByName`
 * is always the target colleague's first name - the same acceptance event
 * covers both shifts in a swap.
 */
export function buildSwapReassignmentDetails(opts: {
  fromName: string;
  toName: string;
  acceptedByName: string;
  approvedByName: string;
}): string {
  return `${opts.fromName} → ${opts.toName} - accepted by ${opts.acceptedByName}, approved by ${opts.approvedByName} (Admin)`;
}

/** First name only, matching the mockup's "accepted by Thomas" (not "Thomas Nguyen"). */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
