"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BidDurationScope } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { notifyAdminOfNewBid } from "@/lib/notifications";

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

  const shift = await db.shift.findUnique({
    where: { id: shiftId },
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

  if (!shift) throw new Error("Shift not found");
  if (shift.status !== "OPEN") throw new Error("This shift is no longer accepting bids");
  if (new Date() > shift.bidDeadlineAt) throw new Error("The bid deadline has passed");

  let partialStartsAt: Date | null = null;
  let partialEndsAt: Date | null = null;

  if (durationScope === "PARTIAL") {
    const ps = parsed.partialStartsAt ? new Date(parsed.partialStartsAt) : null;
    const pe = parsed.partialEndsAt ? new Date(parsed.partialEndsAt) : null;
    if (!ps || !pe || Number.isNaN(ps.getTime()) || Number.isNaN(pe.getTime())) {
      throw new Error("Choose a start and end time for your partial bid.");
    }
    if (ps < shift.startsAt || pe > shift.endsAt) {
      throw new Error("Your times must fall within the posted shift hours.");
    }
    if (ps >= pe) {
      throw new Error("End time must be after start time.");
    }
    partialStartsAt = ps;
    partialEndsAt = pe;
  }

  const scopeEnum = durationScope === "FULL" ? BidDurationScope.FULL : BidDurationScope.PARTIAL;

  await db.shiftBid.upsert({
    where: {
      shiftId_workerId: {
        shiftId,
        workerId: session.user.id,
      },
    },
    update: {
      note,
      hourlyRate: null,
      durationScope: scopeEnum,
      partialStartsAt,
      partialEndsAt,
      status: "PENDING",
    },
    create: {
      shiftId,
      workerId: session.user.id,
      note,
      hourlyRate: null,
      durationScope: scopeEnum,
      partialStartsAt,
      partialEndsAt,
      status: "PENDING",
    },
  });

  await notifyAdminOfNewBid({
    adminId: shift.createdById,
    workerName: session.user.name,
    shift: { id: shift.id, title: shift.title },
  });

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
