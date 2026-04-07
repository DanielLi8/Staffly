"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { differenceInHours } from "date-fns";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { notifyWorkersOfNewShift, notifyWorkersOfAssignment } from "@/lib/notifications";

const createShiftSchema = z.object({
  unit: z.string().min(1, "Unit is required"),
  departmentId: z.string().min(1, "Department is required"),
  roleNeeded: z.string().min(1, "Role is required"),
  location: z.string().min(1, "Location is required"),
  startsAt: z.coerce.date({ required_error: "Start time is required" }),
  endsAt: z.coerce.date({ required_error: "End time is required" }),
  bidDeadlineAt: z.coerce.date({ required_error: "Bid deadline is required" }),
  notes: z.string().optional(),
});

export type CreateShiftInput = z.infer<typeof createShiftSchema>;

export async function createShift(rawInput: unknown) {
  const session = await requireAuth("ADMIN");
  const data = createShiftSchema.parse(rawInput);

  if (data.endsAt <= data.startsAt) {
    throw new Error("End time must be after start time");
  }
  if (data.bidDeadlineAt >= data.startsAt) {
    throw new Error("Bid deadline must be before shift start");
  }
  if (differenceInHours(data.startsAt, data.bidDeadlineAt) < 4) {
    throw new Error("Bids must be submitted at least 4 hours before the shift starts.");
  }

  const dept = await db.department.findUnique({ where: { id: data.departmentId } });
  if (!dept) throw new Error("Department not found");

  const title = `${dept.name} (${dept.code}) – ${data.roleNeeded}`;

  const shift = await db.shift.create({
    data: {
      title,
      unit: data.unit,
      departmentId: data.departmentId,
      roleNeeded: data.roleNeeded,
      location: data.location,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      bidDeadlineAt: data.bidDeadlineAt,
      notes: data.notes,
      status: "OPEN",
      createdById: session.user.id,
    },
  });

  await db.shiftActivity.create({
    data: {
      shiftId: shift.id,
      actorId: session.user.id,
      action: "SHIFT_CREATED",
      details: "Shift posted for callout coverage.",
    },
  });

  const workers = await db.user.findMany({
    where: { role: "WORKER" },
    select: { id: true, name: true, email: true },
  });

  await notifyWorkersOfNewShift(shift, workers);

  revalidatePath("/admin/shifts");
  revalidatePath("/admin");
  redirect(`/admin/shifts/${shift.id}`);
}

export async function assignWorker(shiftId: string, workerId: string) {
  const session = await requireAuth("ADMIN");

  const shift = await db.shift.findUnique({
    where: { id: shiftId },
    include: { bids: { select: { workerId: true } } },
  });

  if (!shift) throw new Error("Shift not found");
  if (shift.status !== "OPEN") throw new Error("Shift is no longer open");

  const bidderIds = shift.bids.map((b) => b.workerId);
  if (!bidderIds.includes(workerId)) {
    throw new Error("Worker has not bid on this shift");
  }

  await db.$transaction([
    db.shift.update({
      where: { id: shiftId },
      data: { status: "ASSIGNED", assignedWorkerId: workerId },
    }),
    db.shiftBid.updateMany({
      where: { shiftId, workerId },
      data: { status: "SELECTED" },
    }),
    db.shiftBid.updateMany({
      where: { shiftId, workerId: { not: workerId } },
      data: { status: "NOT_SELECTED" },
    }),
    db.shiftActivity.create({
      data: {
        shiftId,
        actorId: session.user.id,
        action: "WORKER_ASSIGNED",
        details: `Assigned to worker ID ${workerId}.`,
      },
    }),
  ]);

  await notifyWorkersOfAssignment({
    shift,
    selectedWorkerId: workerId,
    allBidderIds: bidderIds,
  });

  revalidatePath(`/admin/shifts/${shiftId}`);
  revalidatePath("/admin/shifts");
  revalidatePath("/admin");
}

export async function cancelShift(shiftId: string) {
  const session = await requireAuth("ADMIN");

  const shift = await db.shift.findUnique({ where: { id: shiftId } });
  if (!shift) throw new Error("Shift not found");

  await db.$transaction([
    db.shift.update({
      where: { id: shiftId },
      data: { status: "CANCELLED" },
    }),
    db.shiftActivity.create({
      data: {
        shiftId,
        actorId: session.user.id,
        action: "SHIFT_CANCELLED",
        details: "Shift was cancelled by admin.",
      },
    }),
  ]);

  revalidatePath(`/admin/shifts/${shiftId}`);
  revalidatePath("/admin/shifts");
  revalidatePath("/admin");
}
