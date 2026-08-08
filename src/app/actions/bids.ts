"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { submitBid } from "@/lib/outreach/accept";

const placeBidSchema = z.object({
  shiftId: z.string().min(1),
  note: z.string().max(500).optional(),
  durationScope: z.enum(["FULL", "PARTIAL"]),
  partialStartsAt: z.string().optional(),
  partialEndsAt: z.string().optional(),
});

export async function placeBid(rawInput: unknown) {
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
      throw new Error("Choose a start and end time for your partial bid.");
    }
    if (ps >= pe) {
      throw new Error("End time must be after start time.");
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

  if (!result.ok) {
    switch (result.reason) {
      case "SHIFT_NOT_FOUND":
        throw new Error("Shift not found");
      case "SHIFT_CLOSED":
        throw new Error("This shift is no longer accepting bids");
      case "DEADLINE_PASSED":
        throw new Error("The bid deadline has passed");
      case "INVALID_WINDOW":
        throw new Error("Your times must fall within the posted shift hours.");
    }
  }

  revalidatePath(`/worker/shifts/${shiftId}`);
  revalidatePath("/worker/bids");
  revalidatePath("/worker");
}

export async function withdrawBid(shiftId: string) {
  const session = await requireAuth("STAFF");

  const bid = await db.shiftBid.findUnique({
    where: {
      shiftId_workerId: {
        shiftId,
        workerId: session.user.id,
      },
    },
  });

  if (!bid) throw new Error("Bid not found");
  if (bid.status !== "PENDING") throw new Error("Cannot withdraw a processed bid");

  await db.shiftBid.delete({
    where: { id: bid.id },
  });

  revalidatePath(`/worker/shifts/${shiftId}`);
  revalidatePath("/worker/bids");
  revalidatePath("/worker");
}
