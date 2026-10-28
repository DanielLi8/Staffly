/**
 * The SINGLE accept path. In-app bidding, SMS reply codes, and IVR key-presses
 * all funnel through {@link submitBid}. The rule "an acceptance becomes a
 * ShiftBid (never an instant assignment) and every admin is notified" lives
 * here, in exactly one place, so every channel behaves identically.
 */
import { BidDurationScope, Channel, Prisma } from "@prisma/client";
import type { ShiftBid, ShiftStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { guardedTransaction, Rollback } from "@/lib/db-guard";
import { notifyAdminsOfNewBid } from "@/lib/notifications";
import { isCampaignTerminal } from "@/lib/callout/decide";
import { bidAcceptance } from "@/lib/shifts/bid-window";
import { positionMatchesRole } from "@/lib/shifts/role-match";

/** Where an acceptance originated. Drives the scheduler-notification wording. */
export type BidSource = "IN_APP" | "SMS" | "VOICE";

export interface SubmitBidInput {
  shiftId: string;
  workerId: string;
  scope: BidDurationScope;
  source: BidSource;
  note?: string | null;
  /** Only meaningful for PARTIAL bids; validated against the shift window. */
  partialStartsAt?: Date | null;
  partialEndsAt?: Date | null;
}

export type SubmitBidResult =
  | { ok: true; bid: ShiftBid }
  | {
      ok: false;
      reason:
        | "SHIFT_NOT_FOUND"
        | "SHIFT_CLOSED"
        | "SHIFT_ENDED"
        | "INVALID_WINDOW"
        | "POSITION_MISMATCH";
    };

const SOURCE_LABEL: Record<BidSource, string | null> = {
  IN_APP: null,
  SMS: "by text",
  VOICE: "by phone",
};

/**
 * Create or update the worker's bid on a shift and notify every admin.
 *
 * Guards (the bid window - see `bidAcceptance` - position match, partial window
 * within shift hours) are enforced here so a webhook cannot bypass the checks the UI applies. On a
 * guard failure this returns a typed reason instead of throwing, so webhook
 * callers can respond gracefully; the in-app action maps reasons to errors.
 */
export async function submitBid(input: SubmitBidInput): Promise<SubmitBidResult> {
  const shift = await db.shift.findUnique({
    where: { id: input.shiftId },
    select: {
      id: true,
      title: true,
      status: true,
      startsAt: true,
      endsAt: true,
      roleNeeded: true,
      campaign: { select: { status: true } },
    },
  });

  if (!shift) return { ok: false, reason: "SHIFT_NOT_FOUND" };
  // Gated on the shift alone, never the campaign: a stopped or exhausted
  // callout keeps taking bids until the shift is awarded or cancelled.
  const acceptance = bidAcceptance(shift);
  if (!acceptance.open) return { ok: false, reason: acceptance.reason };

  const worker = await db.user.findUnique({
    where: { id: input.workerId },
    select: { name: true, position: true },
  });
  if (!positionMatchesRole(worker?.position, shift.roleNeeded)) {
    return { ok: false, reason: "POSITION_MISMATCH" };
  }

  let partialStartsAt: Date | null = null;
  let partialEndsAt: Date | null = null;

  if (input.scope === "PARTIAL" && input.partialStartsAt && input.partialEndsAt) {
    const ps = input.partialStartsAt;
    const pe = input.partialEndsAt;
    if (Number.isNaN(ps.getTime()) || Number.isNaN(pe.getTime())) {
      return { ok: false, reason: "INVALID_WINDOW" };
    }
    if (ps < shift.startsAt || pe > shift.endsAt || ps >= pe) {
      return { ok: false, reason: "INVALID_WINDOW" };
    }
    partialStartsAt = ps;
    partialEndsAt = pe;
  }

  const scopeEnum =
    input.scope === "PARTIAL" ? BidDurationScope.PARTIAL : BidDurationScope.FULL;

  const data = {
    note: input.note ?? null,
    durationScope: scopeEnum,
    partialStartsAt,
    partialEndsAt,
    status: "PENDING" as const,
  };

  // The bid is written under a SHARE lock on the shift row, re-checking the bid
  // window on the locked row. An award (whose OPEN -> ASSIGNED update needs that
  // row exclusively) therefore either commits first - and this sees ASSIGNED and
  // refuses - or waits for this bid to commit and then marks it NOT_SELECTED.
  // Without the lock a bid could land PENDING on a just-awarded shift (and tell
  // every admin about a "new bid" on it). Concurrent bids share the lock freely.
  const writeBid = () =>
    guardedTransaction<ShiftBid, "SHIFT_CLOSED" | "SHIFT_ENDED" | "SHIFT_NOT_FOUND">(async (tx) => {
      const [locked] = await tx.$queryRaw<{ status: ShiftStatus; endsAt: Date }[]>`
        SELECT "status", "endsAt" FROM "Shift" WHERE "id" = ${shift.id} FOR SHARE`;
      if (!locked) throw new Rollback("SHIFT_NOT_FOUND");
      const stillOpen = bidAcceptance(locked);
      if (!stillOpen.open) throw new Rollback(stillOpen.reason);

      return tx.shiftBid.upsert({
        where: { shiftId_workerId: { shiftId: shift.id, workerId: input.workerId } },
        update: data,
        create: { shiftId: shift.id, workerId: input.workerId, ...data },
      });
    });

  let outcome;
  try {
    outcome = await writeBid();
  } catch (err) {
    // The same worker bidding twice at once (double tap, SMS + app): both saw
    // no row and one insert lost. Its row exists now, so a retry updates it.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    outcome = await writeBid();
  }
  if (!outcome.ok) return { ok: false, reason: outcome.result };
  const bid = outcome.value;

  // The latest answer wins: bidding after a decline takes the decline back, so
  // the worker is a normal bidder again (see ./decline).
  await db.shiftDecline.deleteMany({ where: { shiftId: shift.id, userId: input.workerId } });

  // Record the acceptance against any outreach attempt on the channel it arrived
  // through, so delivery tracking reflects the two-way response.
  const channel = input.source === "SMS" ? Channel.SMS : input.source === "VOICE" ? Channel.VOICE : null;
  if (channel) {
    await db.outreachAttempt.updateMany({
      where: { shiftId: shift.id, userId: input.workerId, channel },
      data: { response: "ACCEPTED", respondedAt: new Date() },
    });
  }

  await notifyAdminsOfNewBid({
    workerName: worker?.name ?? "A worker",
    shift: { id: shift.id, title: shift.title },
    via: SOURCE_LABEL[input.source],
    outreachEnded: shift.campaign ? isCampaignTerminal(shift.campaign.status) : false,
  });

  return { ok: true, bid };
}
