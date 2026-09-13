"use server";

/**
 * ADMIN-side approve/deny for Shift Swap / Giveaway. Approving is the ONLY
 * point in the whole pipeline where `Shift.assignedWorkerId` actually
 * changes - both shifts trade owners for a SWAP, matching the transactional
 * `db.$transaction([...])` + `ShiftActivity` pattern `assignWorker`/
 * `cancelShift` already use in `src/app/actions/shifts.ts`. Denying is
 * terminal and never touches a `Shift` row.
 */
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth";
import { hospitalDateTime } from "@/lib/timezone";
import { notifyPartiesOfShiftSwapDecision } from "@/lib/notifications";
import { SWAP_REASSIGNED_ACTION, buildSwapReassignmentDetails, firstName } from "@/lib/shift-swap/audit";
import type { ShiftSwapKind } from "@/features/shift-swap/types";

export interface PendingShiftSwapApproval {
  id: string;
  kind: ShiftSwapKind;
  requesterName: string;
  targetName: string;
  respondedAt: Date | null;
  giveShift: { startsAt: Date; endsAt: Date; departmentName: string; roleNeeded: string };
  receiveShift: { startsAt: Date; endsAt: Date } | null;
}

/** Requests the colleague has accepted and that now await a manager's decision. */
export async function listPendingShiftSwapApprovals(): Promise<PendingShiftSwapApproval[]> {
  await requireActor("ADMIN");

  const requests = await db.shiftSwapRequest.findMany({
    where: { status: "PENDING_APPROVAL" },
    include: {
      requester: { select: { name: true } },
      targetUser: { select: { name: true } },
      giveShift: { select: { startsAt: true, endsAt: true, roleNeeded: true, department: { select: { name: true } } } },
      receiveShift: { select: { startsAt: true, endsAt: true } },
    },
    orderBy: { respondedAt: "asc" },
  });

  return requests.map((r) => ({
    id: r.id,
    kind: r.kind,
    requesterName: r.requester.name,
    targetName: r.targetUser.name,
    respondedAt: r.respondedAt,
    giveShift: {
      startsAt: r.giveShift.startsAt,
      endsAt: r.giveShift.endsAt,
      departmentName: r.giveShift.department.name,
      roleNeeded: r.giveShift.roleNeeded,
    },
    receiveShift: r.receiveShift ? { startsAt: r.receiveShift.startsAt, endsAt: r.receiveShift.endsAt } : null,
  }));
}

export type SwapApprovalResult = { ok: true } | { ok: false; error: string };

async function loadPendingApproval(requestId: string) {
  const request = await db.shiftSwapRequest.findUnique({
    where: { id: requestId },
    include: {
      giveShift: true,
      receiveShift: true,
      requester: { select: { id: true, name: true } },
      targetUser: { select: { id: true, name: true } },
    },
  });

  if (!request) return { request: null, error: "Request not found." } as const;
  if (request.status !== "PENDING_APPROVAL") {
    return { request: null, error: "This request is no longer awaiting approval." } as const;
  }
  return { request, error: null } as const;
}

/**
 * The only mutation of `Shift.assignedWorkerId` in the whole pipeline. Both
 * shifts must still be assigned exactly as they were when the request was
 * created/accepted - either side's shift could have been cancelled or
 * reassigned in the meantime - or this fails closed with a typed error
 * rather than silently reassigning a shift out from under someone.
 */
export async function approveShiftSwapRequest(requestId: string): Promise<SwapApprovalResult> {
  const actor = await requireActor("ADMIN");
  const { request, error } = await loadPendingApproval(requestId);
  if (!request) return { ok: false, error: error! };

  if (request.giveShift.status !== "ASSIGNED" || request.giveShift.assignedWorkerId !== request.requesterId) {
    return { ok: false, error: "The give shift is no longer valid for this request." };
  }
  if (request.kind === "SWAP") {
    if (
      !request.receiveShift ||
      request.receiveShift.status !== "ASSIGNED" ||
      request.receiveShift.assignedWorkerId !== request.targetUserId
    ) {
      return { ok: false, error: "The receive shift is no longer valid for this request." };
    }
  }

  const admin = await db.user.findUnique({ where: { id: actor.id }, select: { name: true } });
  const approverName = admin?.name ?? "Admin";
  const acceptedByName = firstName(request.targetUser.name);
  const action = SWAP_REASSIGNED_ACTION[request.kind];
  const now = new Date();

  const operations = [
    db.shift.update({
      where: { id: request.giveShiftId },
      data: { assignedWorkerId: request.targetUserId },
    }),
    db.shiftActivity.create({
      data: {
        shiftId: request.giveShiftId,
        actorId: actor.id,
        action,
        details: buildSwapReassignmentDetails({
          fromName: request.requester.name,
          toName: request.targetUser.name,
          acceptedByName,
          approvedByName: approverName,
        }),
      },
    }),
    db.shiftSwapRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", approvedById: actor.id, approvedAt: now },
    }),
  ];

  if (request.kind === "SWAP" && request.receiveShift) {
    operations.push(
      db.shift.update({
        where: { id: request.receiveShift.id },
        data: { assignedWorkerId: request.requesterId },
      }),
      db.shiftActivity.create({
        data: {
          shiftId: request.receiveShift.id,
          actorId: actor.id,
          action,
          details: buildSwapReassignmentDetails({
            fromName: request.targetUser.name,
            toName: request.requester.name,
            acceptedByName,
            approvedByName: approverName,
          }),
        },
      })
    );
  }

  await db.$transaction(operations);

  await notifyPartiesOfShiftSwapDecision({
    requesterId: request.requesterId,
    targetUserId: request.targetUserId,
    approved: true,
    approverName,
    kind: request.kind,
    shiftDateLabel: hospitalDateTime(request.giveShift.startsAt),
  });

  revalidatePath("/admin/shift-swaps");
  revalidatePath(`/admin/shifts/${request.giveShiftId}`);
  if (request.receiveShift) revalidatePath(`/admin/shifts/${request.receiveShift.id}`);
  revalidatePath("/worker/schedule");

  return { ok: true };
}

/** Terminal, no `Shift` row is touched. */
export async function denyShiftSwapRequest(requestId: string): Promise<SwapApprovalResult> {
  const actor = await requireActor("ADMIN");
  const { request, error } = await loadPendingApproval(requestId);
  if (!request) return { ok: false, error: error! };

  const admin = await db.user.findUnique({ where: { id: actor.id }, select: { name: true } });
  const approverName = admin?.name ?? "Admin";

  await db.shiftSwapRequest.update({
    where: { id: requestId },
    data: { status: "DENIED", approvedById: actor.id, approvedAt: new Date() },
  });

  await notifyPartiesOfShiftSwapDecision({
    requesterId: request.requesterId,
    targetUserId: request.targetUserId,
    approved: false,
    approverName,
    kind: request.kind,
    shiftDateLabel: hospitalDateTime(request.giveShift.startsAt),
  });

  revalidatePath("/admin/shift-swaps");

  return { ok: true };
}
