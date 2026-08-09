/**
 * The SINGLE accept path. In-app bidding, SMS reply codes, and IVR key-presses
 * all funnel through {@link submitBid}. The rule "an acceptance becomes a
 * ShiftBid (never an instant assignment) and the scheduler is notified" lives
 * here, in exactly one place, so every channel behaves identically.
 */
import { BidDurationScope, Channel } from "@prisma/client";
import type { ShiftBid } from "@prisma/client";
import { db } from "@/lib/db";
import { notifyAdminOfNewBid } from "@/lib/notifications";

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
  | { ok: false; reason: "SHIFT_NOT_FOUND" | "SHIFT_CLOSED" | "DEADLINE_PASSED" | "INVALID_WINDOW" };

const SOURCE_LABEL: Record<BidSource, string | null> = {
  IN_APP: null,
  SMS: "by text",
  VOICE: "by phone",
};

/**
 * Create or update the worker's bid on a shift and notify the scheduler.
 *
 * Guards (shift open, deadline not passed, partial window within shift hours)
 * are enforced here so a webhook cannot bypass the checks the UI applies. On a
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
      bidDeadlineAt: true,
      createdById: true,
      startsAt: true,
      endsAt: true,
    },
  });

  if (!shift) return { ok: false, reason: "SHIFT_NOT_FOUND" };
  if (shift.status !== "OPEN") return { ok: false, reason: "SHIFT_CLOSED" };
  if (new Date() > shift.bidDeadlineAt) return { ok: false, reason: "DEADLINE_PASSED" };

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

  const bid = await db.shiftBid.upsert({
    where: { shiftId_workerId: { shiftId: shift.id, workerId: input.workerId } },
    update: {
      note: input.note ?? null,
      durationScope: scopeEnum,
      partialStartsAt,
      partialEndsAt,
      status: "PENDING",
    },
    create: {
      shiftId: shift.id,
      workerId: input.workerId,
      note: input.note ?? null,
      durationScope: scopeEnum,
      partialStartsAt,
      partialEndsAt,
      status: "PENDING",
    },
  });

  // Record the acceptance against any outreach attempt on the channel it arrived
  // through, so delivery tracking reflects the two-way response.
  const channel = input.source === "SMS" ? Channel.SMS : input.source === "VOICE" ? Channel.VOICE : null;
  if (channel) {
    await db.outreachAttempt.updateMany({
      where: { shiftId: shift.id, userId: input.workerId, channel },
      data: { response: "ACCEPTED", respondedAt: new Date() },
    });
  }

  const worker = await db.user.findUnique({
    where: { id: input.workerId },
    select: { name: true },
  });

  await notifyAdminOfNewBid({
    adminId: shift.createdById,
    workerName: worker?.name ?? "A worker",
    shift: { id: shift.id, title: shift.title },
    via: SOURCE_LABEL[input.source],
  });

  return { ok: true, bid };
}
