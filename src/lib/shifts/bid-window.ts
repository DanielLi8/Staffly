import type { Prisma, ShiftStatus } from "@prisma/client";

/**
 * When a shift accepts bids. PURE, and the one place this rule lives: the
 * single accept path (`submitBid`, so in-app, SMS and voice alike), the
 * worker's bid form, and the worker "available shifts" queries all follow it.
 *
 * The rule: a shift takes bids while it is OPEN (not yet awarded or
 * cancelled) and has not ended. There is no separate bid deadline - a callout
 * keeps accepting after the shift's start time, because a hospital still needs
 * the shift covered once it has started.
 *
 * The callout campaign's status is deliberately NOT an input. Stopping the
 * cascade ("Stop outreach") or running out of tiers only ends the texts and
 * calls; anyone can still bid in the app or by replying to earlier outreach
 * until the shift is awarded or cancelled.
 */
export type BidAcceptance =
  | { open: true }
  | {
      open: false;
      /** SHIFT_CLOSED: awarded or cancelled. SHIFT_ENDED: still unfilled, but over. */
      reason: "SHIFT_CLOSED" | "SHIFT_ENDED";
    };

export function bidAcceptance(
  shift: { status: ShiftStatus; endsAt: Date },
  now: Date = new Date()
): BidAcceptance {
  if (shift.status !== "OPEN") return { open: false, reason: "SHIFT_CLOSED" };
  if (now >= shift.endsAt) return { open: false, reason: "SHIFT_ENDED" };
  return { open: true };
}

/** {@link bidAcceptance} as a query filter: exactly the shifts it calls open. */
export function biddableShiftWhere(now: Date = new Date()): Prisma.ShiftWhereInput {
  return { status: "OPEN", endsAt: { gt: now } };
}
