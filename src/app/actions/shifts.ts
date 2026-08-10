"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { notifyWorkersOfAssignment } from "@/lib/notifications";
import { generateShiftCode } from "@/lib/outreach/codes";
import { markCampaignFilled, startCalloutCampaign } from "@/lib/callout/campaign";
import { validateShiftTimes, type ShiftFieldErrors } from "@/lib/shifts/validation";

const createShiftSchema = z.object({
  unit: z.string().min(1, "Unit is required"),
  departmentId: z.string().min(1, "Department is required"),
  roleNeeded: z.string().min(1, "Role is required"),
  location: z.string().min(1, "Location is required"),
  startsAt: z.coerce.date({
    required_error: "Start time is required",
    invalid_type_error: "Enter a valid start date and time",
  }),
  endsAt: z.coerce.date({
    required_error: "End time is required",
    invalid_type_error: "Enter a valid end date and time",
  }),
  bidDeadlineAt: z.coerce.date({
    required_error: "Bid deadline is required",
    invalid_type_error: "Enter a valid bid deadline date and time",
  }),
  notes: z.string().optional(),
});

export type CreateShiftInput = z.infer<typeof createShiftSchema>;

/**
 * Validation is returned, never thrown. Next.js replaces a thrown server-action
 * error with an opaque "digest" message in production, so a routine bad input
 * would otherwise reach the scheduler looking like a crash.
 */
export interface CreateShiftFailure {
  ok: false;
  fieldErrors: ShiftFieldErrors;
  formError?: string;
}

function failure(fieldErrors: ShiftFieldErrors, formError?: string): CreateShiftFailure {
  return { ok: false, fieldErrors, formError };
}

/**
 * Create a shift with a unique short `smsCode` used by inbound SMS replies.
 * Retries on the (astronomically unlikely) unique-collision so posting is never
 * blocked by a code clash.
 */
async function createShiftWithUniqueCode(
  data: Omit<Prisma.ShiftUncheckedCreateInput, "smsCode">
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.shift.create({
        data: { ...data, smsCode: generateShiftCode() },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        attempt < 4
      ) {
        continue;
      }
      throw err;
    }
  }
  // Unreachable: the loop either returns or throws.
  throw new Error("Could not allocate a unique shift code");
}

export async function createShift(rawInput: unknown): Promise<CreateShiftFailure> {
  const session = await requireAuth("SCHEDULER");

  const parsed = createShiftSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: ShiftFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return failure(fieldErrors, "Please correct the highlighted fields.");
  }
  const data = parsed.data;

  const timeErrors = validateShiftTimes(data);
  if (Object.keys(timeErrors).length > 0) {
    return failure(timeErrors);
  }

  const dept = await db.department.findUnique({ where: { id: data.departmentId } });
  if (!dept) return failure({ departmentId: "Department not found" });

  const title = `${dept.name} (${dept.code}) – ${data.roleNeeded}`;

  const shift = await createShiftWithUniqueCode({
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
  });

  await db.shiftActivity.create({
    data: {
      shiftId: shift.id,
      actorId: session.user.id,
      action: "SHIFT_CREATED",
      details: "Shift posted for callout coverage.",
    },
  });

  // Open the tiered callout cascade. Outreach is deliberately NOT sent here:
  // the campaign records when tier 1 falls due (~1 minute out) and Inngest's
  // durable timer sends it, so a shift pulled inside that window reaches nobody.
  await startCalloutCampaign(shift.id);

  revalidatePath("/admin/shifts");
  revalidatePath("/admin");
  redirect(`/admin/shifts/${shift.id}`);
}

export async function assignWorker(shiftId: string, workerId: string) {
  const session = await requireAuth("SCHEDULER");

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

  // The shift is filled, so the cascade must stop widening immediately.
  await markCampaignFilled(shiftId, { actorId: session.user.id });

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
  const session = await requireAuth("SCHEDULER");

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

  // A cancelled shift must not keep escalating. The campaign service allows this
  // even though the shift is no longer OPEN.
  await db.calloutCampaign.updateMany({
    where: { shiftId, status: { in: ["RUNNING", "PAUSED"] } },
    data: { status: "CANCELLED", endedAt: new Date() },
  });

  revalidatePath(`/admin/shifts/${shiftId}`);
  revalidatePath("/admin/shifts");
  revalidatePath("/admin");
}
