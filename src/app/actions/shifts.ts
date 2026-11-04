"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma, type Shift, type ShiftStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { notifyWorkersOfAssignment, notifyWorkerOfCancellation } from "@/lib/notifications";
import { generateShiftCode } from "@/lib/outreach/codes";
import { markCampaignFilled, startCalloutCampaign } from "@/lib/callout/campaign";
import { validateShiftTimes, SHIFT_TIME_MESSAGES, type ShiftFieldErrors } from "@/lib/shifts/validation";
import { formatShiftRange } from "@/lib/utils";
import { guardedTransaction, Rollback } from "@/lib/db-guard";
import { describeShiftConflict } from "@/lib/shifts/conflict";
import { canCancelShift } from "@/lib/shift-status";

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
  const session = await requireAuth("ADMIN");

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

  const timeErrors = validateShiftTimes(data, new Date());
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

export type AssignWorkerResult = { ok: true } | { ok: false; error: string };

/**
 * Award a shift to one of its bidders.
 *
 * Race-safe by construction: the OPEN -> ASSIGNED write is conditional on the
 * shift still being OPEN and the chosen bid still being PENDING, inside one
 * transaction. Two admins awarding at once (or an award racing a withdrawal,
 * a cancel, or a late bid) therefore produce exactly one winner; the loser
 * rolls back and gets a typed failure naming what happened instead, e.g.
 * "This shift was just awarded to Maria Santos by James Okafor." Nobody is
 * notified until the winning transaction has committed.
 *
 * Failures are returned, never thrown: a thrown Server Action error renders as
 * an opaque digest in production (issue #7).
 */
export async function assignWorker(shiftId: string, workerId: string): Promise<AssignWorkerResult> {
  const session = await requireAuth("ADMIN");

  const outcome = await guardedTransaction<Shift & { bids: { workerId: string }[] }, "SHIFT" | "BID">(
    async (tx) => {
      const won = await tx.shift.updateMany({
        where: { id: shiftId, status: "OPEN" },
        data: { status: "ASSIGNED", assignedWorkerId: workerId, version: { increment: 1 } },
      });
      if (won.count !== 1) throw new Rollback("SHIFT");

      const picked = await tx.shiftBid.updateMany({
        where: { shiftId, workerId, status: "PENDING" },
        data: { status: "SELECTED" },
      });
      if (picked.count !== 1) throw new Rollback("BID");

      await tx.shiftBid.updateMany({
        where: { shiftId, workerId: { not: workerId } },
        data: { status: "NOT_SELECTED" },
      });
      const worker = await tx.user.findUnique({ where: { id: workerId }, select: { name: true } });
      await tx.shiftActivity.create({
        data: {
          shiftId,
          actorId: session.user.id,
          action: "WORKER_ASSIGNED",
          details: `Assigned to ${worker?.name ?? "a worker"}.`,
        },
      });
      // Read back inside the transaction: the bidder set is exactly the one
      // this award closed out (a concurrent bid either landed before the
      // update above, and was marked NOT_SELECTED, or is refused by submitBid).
      return tx.shift.findUniqueOrThrow({
        where: { id: shiftId },
        include: { bids: { select: { workerId: true } } },
      });
    }
  );

  if (!outcome.ok) {
    if (outcome.result === "BID") {
      const worker = await db.user.findUnique({ where: { id: workerId }, select: { name: true } });
      return { ok: false, error: `${worker?.name ?? "This worker"} just withdrew their bid, so they can't be awarded this shift.` };
    }
    return { ok: false, error: await describeShiftConflict(shiftId) };
  }
  const shift = outcome.value;

  // The shift is filled, so the cascade must stop widening immediately.
  await markCampaignFilled(shiftId, { actorId: session.user.id });

  await notifyWorkersOfAssignment({
    shift,
    selectedWorkerId: workerId,
    allBidderIds: shift.bids.map((b) => b.workerId),
  });

  revalidatePath(`/admin/shifts/${shiftId}`);
  revalidatePath("/admin/shifts");
  revalidatePath("/admin");

  return { ok: true };
}

/** Statuses a shift can still be edited or cancelled in; see `canCancelShift`. */
const MUTABLE_STATUSES: ShiftStatus[] = ["OPEN", "ASSIGNED"];

const editShiftTimeSchema = z.object({
  shiftId: z.string().min(1),
  startsAt: z.coerce.date({ invalid_type_error: "Enter a valid start date and time" }),
  endsAt: z.coerce.date({ invalid_type_error: "Enter a valid end date and time" }),
  /** `Shift.version` when the admin opened the editor. */
  expectedVersion: z.number().int(),
});

export interface EditShiftTimeFailure {
  ok: false;
  fieldErrors: ShiftFieldErrors;
  formError?: string;
}

/** Appended to a conflict message on the edit and cancel paths. */
const REVIEW_AND_RETRY = "Review the latest details and try again.";

/**
 * Only checks endsAt > startsAt, not the full validateShiftTimes rules: this
 * routinely edits a shift that is assigned or already under way, whose start
 * is legitimately in the past, so "start must be in the future" would wrongly
 * refuse a correction to it.
 *
 * Optimistic concurrency: the write only lands if `Shift.version` is still the
 * one the editor was opened on, so of two admins editing the same hours the
 * second is told who changed them, rather than silently overwriting them.
 */
export async function editShiftTime(
  rawInput: unknown
): Promise<EditShiftTimeFailure | { ok: true }> {
  const session = await requireAuth("ADMIN");

  const parsed = editShiftTimeSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: ShiftFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { ok: false, fieldErrors, formError: "Please correct the highlighted fields." };
  }
  const data = parsed.data;

  const shift = await db.shift.findUnique({ where: { id: data.shiftId } });
  if (!shift) throw new Error("Shift not found");

  const conflict = async (): Promise<EditShiftTimeFailure> => ({
    ok: false,
    fieldErrors: {},
    formError: `${await describeShiftConflict(shift.id)} ${REVIEW_AND_RETRY}`,
  });
  if (shift.version !== data.expectedVersion) return conflict();

  // A CANCELLED or CLOSED shift is a terminal state: the product rule is that the only way to
  // change a shift past that point is to create an entirely new request, not edit the old one.
  if (!MUTABLE_STATUSES.includes(shift.status)) {
    return {
      ok: false,
      fieldErrors: {},
      formError: `This shift is ${shift.status === "CANCELLED" ? "cancelled" : "closed"} and can no longer be edited.`,
    };
  }

  if (data.endsAt <= data.startsAt) {
    return { ok: false, fieldErrors: { endsAt: SHIFT_TIME_MESSAGES.endBeforeStart } };
  }

  const outcome = await guardedTransaction<void, "STALE">(async (tx) => {
    const won = await tx.shift.updateMany({
      where: { id: shift.id, version: data.expectedVersion, status: { in: MUTABLE_STATUSES } },
      data: { startsAt: data.startsAt, endsAt: data.endsAt, version: { increment: 1 } },
    });
    if (won.count !== 1) throw new Rollback("STALE");
    await tx.shiftActivity.create({
      data: {
        shiftId: shift.id,
        actorId: session.user.id,
        action: "SHIFT_TIME_EDITED",
        // `shift` was read at the expected version and every shift write bumps
        // it, so these are exactly the times this write replaced.
        details: `Time changed from ${formatShiftRange(shift.startsAt, shift.endsAt)} to ${formatShiftRange(data.startsAt, data.endsAt)}.`,
      },
    });
  });
  if (!outcome.ok) return conflict();

  revalidatePath(`/admin/shifts/${shift.id}`);
  return { ok: true };
}

export type CancelShiftResult = { ok: true } | { ok: false; error: string };

/**
 * Cancel a shift the admin is looking at. Conditional on `Shift.version` being
 * the one their page rendered and on the shift still being cancellable
 * (`canCancelShift`), so a cancel can't resurrect over, or silently undo, an
 * award or edit another admin just made: the shift, the campaign stop and the
 * activity row commit together or not at all. The assignee to notify is read
 * from the row this cancel actually changed.
 */
export async function cancelShift(shiftId: string, expectedVersion: number): Promise<CancelShiftResult> {
  const session = await requireAuth("ADMIN");

  const outcome = await guardedTransaction<Shift, "STALE">(async (tx) => {
    const won = await tx.shift.updateMany({
      where: { id: shiftId, version: expectedVersion, status: { in: MUTABLE_STATUSES } },
      data: { status: "CANCELLED", version: { increment: 1 } },
    });
    if (won.count !== 1) throw new Rollback("STALE");
    await tx.shiftActivity.create({
      data: {
        shiftId,
        actorId: session.user.id,
        action: "SHIFT_CANCELLED",
        details: "Shift was cancelled by admin.",
      },
    });
    // A cancelled shift must not keep escalating. The campaign service allows
    // this even though the shift is no longer OPEN.
    await tx.calloutCampaign.updateMany({
      where: { shiftId, status: { in: ["RUNNING", "PAUSED"] } },
      data: { status: "CANCELLED", endedAt: new Date() },
    });
    return tx.shift.findUniqueOrThrow({ where: { id: shiftId } });
  });

  if (!outcome.ok) {
    const current = await db.shift.findUnique({ where: { id: shiftId }, select: { version: true, status: true } });
    if (current && current.version === expectedVersion && !canCancelShift(current.status)) {
      return { ok: false, error: `This shift is ${current.status === "CANCELLED" ? "already cancelled" : "closed"}.` };
    }
    return { ok: false, error: `${await describeShiftConflict(shiftId)} ${REVIEW_AND_RETRY}` };
  }
  const shift = outcome.value;

  if (shift.assignedWorkerId) {
    await notifyWorkerOfCancellation({ shift, workerId: shift.assignedWorkerId });
  }

  revalidatePath(`/admin/shifts/${shiftId}`);
  revalidatePath("/admin/shifts");
  revalidatePath("/admin");
  revalidatePath("/admin/schedule");
  return { ok: true };
}
