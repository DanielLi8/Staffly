"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actorFromSession, requireAuth } from "@/lib/auth";
import { shiftListWhere } from "@/lib/authz";
import { submitBid } from "@/lib/outreach/accept";
import { recordDecline, type RecordDeclineResult } from "@/lib/outreach/decline";

const placeBidSchema = z.object({
  shiftId: z.string().min(1),
  note: z.string().max(500).optional(),
  durationScope: z.enum(["FULL", "PARTIAL"]),
  partialStartsAt: z.string().optional(),
  partialEndsAt: z.string().optional(),
});

/**
 * Returned, never thrown, for anything a worker can routinely hit - above all
 * the shift being awarded or cancelled while they bid. A thrown Server Action
 * error reaches the user as an opaque digest in production (issue #7).
 */
export type BidActionResult = { ok: true } | { ok: false; error: string };

const BID_FAILURE_MESSAGE: Record<Extract<Awaited<ReturnType<typeof submitBid>>, { ok: false }>["reason"], string> = {
  SHIFT_NOT_FOUND: "This shift no longer exists.",
  SHIFT_CLOSED: "This shift is no longer accepting bids - it was just awarded or cancelled.",
  SHIFT_ENDED: "This shift has already ended.",
  INVALID_WINDOW: "Your times must fall within the posted shift hours.",
  POSITION_MISMATCH: "Your position doesn't match the role this shift needs.",
};

export async function placeBid(rawInput: unknown): Promise<BidActionResult> {
  const session = await requireAuth("STAFF");
  const parsed = placeBidSchema.parse(rawInput);
  const { shiftId, note, durationScope } = parsed;

  // Parse/validate the partial window up front so the in-app form gives a precise
  // error; the single accept path re-checks it against the shift hours.
  let partialStartsAt: Date | null = null;
  let partialEndsAt: Date | null = null;
  if (durationScope === "PARTIAL") {
    const ps = parsed.partialStartsAt ? new Date(parsed.partialStartsAt) : null;
    const pe = parsed.partialEndsAt ? new Date(parsed.partialEndsAt) : null;
    if (!ps || !pe || Number.isNaN(ps.getTime()) || Number.isNaN(pe.getTime())) {
      return { ok: false, error: "Choose a start and end time for your partial bid." };
    }
    if (ps >= pe) {
      return { ok: false, error: "End time must be after start time." };
    }
    partialStartsAt = ps;
    partialEndsAt = pe;
  }

  // Every acceptance path (in-app, SMS, IVR) funnels through submitBid.
  const result = await submitBid({
    shiftId,
    workerId: session.user.id,
    scope: durationScope,
    source: "IN_APP",
    note,
    partialStartsAt,
    partialEndsAt,
  });

  if (!result.ok) return { ok: false, error: BID_FAILURE_MESSAGE[result.reason] };

  revalidatePath(`/worker/shifts/${shiftId}`);
  revalidatePath("/worker/bids");
  revalidatePath("/worker");
  return { ok: true };
}

/**
 * Withdraw only while the bid is still PENDING, in the same statement that
 * deletes it: an admin awarding this bid at the same moment either commits
 * first (the bid is SELECTED and stays) or finds the bid gone and rolls the
 * award back. Never "assigned with no bid".
 */
export async function withdrawBid(shiftId: string): Promise<BidActionResult> {
  const session = await requireAuth("STAFF");

  const { count } = await db.shiftBid.deleteMany({
    where: { shiftId, workerId: session.user.id, status: "PENDING" },
  });

  if (count !== 1) {
    const bid = await db.shiftBid.findUnique({
      where: { shiftId_workerId: { shiftId, workerId: session.user.id } },
      select: { status: true },
    });
    if (!bid) return { ok: false, error: "You no longer have a bid on this shift." };
    return {
      ok: false,
      error:
        bid.status === "SELECTED"
          ? "You were just awarded this shift, so the bid can't be withdrawn. Contact the staffing office if you can't work it."
          : "This shift was just awarded to someone else.",
    };
  }

  revalidatePath(`/worker/shifts/${shiftId}`);
  revalidatePath("/worker/bids");
  revalidatePath("/worker");
  return { ok: true };
}

export type DeclineShiftResult = { ok: true } | Extract<RecordDeclineResult, { ok: false }>;

/**
 * The in-app Decline button. Same single decline path as an SMS "NO" or IVR
 * key 2. A routine race (the shift was awarded or the bid processed since the
 * page rendered) comes back as a typed failure, never a throw.
 */
export async function declineShift(shiftId: string): Promise<DeclineShiftResult> {
  const session = await requireAuth("STAFF");
  const id = z.string().min(1).parse(shiftId);

  // Only a shift the worker can see (their read scope, the security boundary).
  const visible = await db.shift.findFirst({
    where: shiftListWhere(actorFromSession(session), { id }),
    select: { id: true },
  });
  if (!visible) return { ok: false, reason: "SHIFT_NOT_FOUND" };

  const result = await recordDecline({ shiftId: id, workerId: session.user.id, source: "IN_APP" });
  if (!result.ok) return result;

  revalidatePath(`/worker/shifts/${id}`);
  revalidatePath("/worker/shifts");
  revalidatePath("/worker/bids");
  revalidatePath("/worker");
  return { ok: true };
}
