/**
 * The SINGLE decline path - the mirror of `submitBid` (./accept). The in-app
 * Decline button, an SMS `NO <code>` reply and IVR key 2 all funnel through
 * {@link recordDecline}, so a "no" means the same thing on every channel:
 *
 *   - a `ShiftDecline` row exists for (shift, worker) - the cascade skips them
 *     from then on (`runTierOutreach`), so nobody is re-contacted about a shift
 *     they turned down;
 *   - a PENDING bid they had is withdrawn (the latest answer wins; a later bid
 *     through `submitBid` deletes the decline again);
 *   - the outreach attempt on the channel it arrived through reads DECLINED,
 *     like `submitBid` marks ACCEPTED.
 *
 * Gated like a bid: once the shift no longer takes bids there is nothing left
 * to decline, and a processed (awarded) bid is never silently undone.
 */
import type { Channel, ShiftDecline } from "@prisma/client";
import { db } from "@/lib/db";
import { bidAcceptance, biddableShiftWhere } from "@/lib/shifts/bid-window";
import type { BidSource } from "./accept";

export interface RecordDeclineInput {
  shiftId: string;
  workerId: string;
  source: BidSource;
}

export type RecordDeclineResult =
  | { ok: true; decline: ShiftDecline; withdrewBid: boolean }
  | { ok: false; reason: "SHIFT_NOT_FOUND" | "SHIFT_CLOSED" | "SHIFT_ENDED" | "BID_PROCESSED" };

const SOURCE_CHANNEL: Record<BidSource, Channel> = {
  IN_APP: "IN_APP",
  SMS: "SMS",
  VOICE: "VOICE",
};

export async function recordDecline(input: RecordDeclineInput): Promise<RecordDeclineResult> {
  const shift = await db.shift.findUnique({
    where: { id: input.shiftId },
    select: { id: true, status: true, endsAt: true },
  });
  if (!shift) return { ok: false, reason: "SHIFT_NOT_FOUND" };

  const acceptance = bidAcceptance(shift);
  if (!acceptance.open) return { ok: false, reason: acceptance.reason };

  const bid = await db.shiftBid.findUnique({
    where: { shiftId_workerId: { shiftId: shift.id, workerId: input.workerId } },
    select: { id: true, status: true },
  });
  if (bid && bid.status !== "PENDING") return { ok: false, reason: "BID_PROCESSED" };

  const channel = SOURCE_CHANNEL[input.source];
  const now = new Date();

  const decline = await db.$transaction(async (tx) => {
    if (bid) {
      // Conditional so a bid awarded since the read above is never deleted.
      await tx.shiftBid.deleteMany({ where: { id: bid.id, status: "PENDING" } });
    }
    await tx.outreachAttempt.updateMany({
      where: { shiftId: shift.id, userId: input.workerId, channel },
      data: { response: "DECLINED", respondedAt: now },
    });
    return tx.shiftDecline.upsert({
      where: { shiftId_userId: { shiftId: shift.id, userId: input.workerId } },
      create: { shiftId: shift.id, userId: input.workerId, source: channel },
      update: { source: channel },
    });
  });

  return { ok: true, decline, withdrewBid: !!bid };
}

/**
 * The open shifts a worker could mean by a bare "NO" text: shifts they were
 * texted about, have not answered on SMS, have not declined, and that still
 * take bids. Newest first.
 */
export async function outstandingSmsCallouts(workerId: string): Promise<{ id: string; title: string }[]> {
  const attempts = await db.outreachAttempt.findMany({
    where: {
      userId: workerId,
      channel: "SMS",
      response: null,
      shift: {
        ...biddableShiftWhere(),
        declines: { none: { userId: workerId } },
      },
    },
    orderBy: { createdAt: "desc" },
    select: { shift: { select: { id: true, title: true } } },
  });
  const seen = new Map<string, { id: string; title: string }>();
  for (const a of attempts) seen.set(a.shift.id, a.shift);
  return Array.from(seen.values());
}
