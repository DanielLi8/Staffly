"use server";

/**
 * ADMIN-side approve/deny for Shift Swap / Giveaway. Approving is the ONLY
 * point in the whole pipeline where `Shift.assignedWorkerId` actually
 * changes - both shifts trade owners for a SWAP, in one guarded transaction
 * with a `ShiftActivity` row per shift, like `assignWorker`/`cancelShift` in
 * `src/app/actions/shifts.ts`. Denying is terminal and never touches a `Shift`
 * row.
 */
import { revalidatePath } from "next/cache";
import type { ShiftSwapStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { guardedTransaction, Rollback } from "@/lib/db-guard";
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

const DECIDED_STATUS_WORD: Partial<Record<ShiftSwapStatus, string>> = {
  APPROVED: "approved",
  DENIED: "denied",
  CANCELLED: "withdrawn",
};

/**
 * Why a request is no longer awaiting approval, naming the admin who decided
 * it when another admin just did.
 */
async function describeDecidedRequest(requestId: string): Promise<string> {
  const request = await db.shiftSwapRequest.findUnique({
    where: { id: requestId },
    select: { status: true, approvedBy: { select: { name: true } } },
  });
  if (!request) return "Request not found.";
  const word = DECIDED_STATUS_WORD[request.status];
  if (!word) return "This request is no longer awaiting approval.";
  const by = request.approvedBy && request.status !== "CANCELLED" ? ` by ${request.approvedBy.name}` : "";
  return `This request was just ${word}${by}.`;
}

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
    return { request: null, error: await describeDecidedRequest(requestId) } as const;
  }
  return { request, error: null } as const;
}

type ApprovalRollback = "DECIDED" | "GIVE_SHIFT" | "RECEIVE_SHIFT";

const SHIFT_GONE_MESSAGE: Record<Exclude<ApprovalRollback, "DECIDED">, string> = {
  GIVE_SHIFT: "The give shift is no longer valid for this request.",
  RECEIVE_SHIFT: "The receive shift is no longer valid for this request.",
};

/**
 * The only mutation of `Shift.assignedWorkerId` in the whole pipeline.
 *
 * Everything is decided INSIDE one transaction by conditional writes, not by
 * the pre-check above it: the request only moves PENDING_APPROVAL -> APPROVED
 * if it is still pending (so approve racing deny, or a double click, has one
 * winner), and each shift only changes hands if it is still ASSIGNED to the
 * person giving it up (so two approvals moving the same shift, or an approval
 * racing a cancel or edit, have one winner). Shifts are written in id order so
 * two swaps touching the same pair of shifts can't deadlock. Any miss rolls the
 * whole approval back and the loser is told what happened.
 */
export async function approveShiftSwapRequest(requestId: string): Promise<SwapApprovalResult> {
  const actor = await requireActor("ADMIN");
  const { request, error } = await loadPendingApproval(requestId);
  if (!request) return { ok: false, error: error! };

  if (request.giveShift.status !== "ASSIGNED" || request.giveShift.assignedWorkerId !== request.requesterId) {
    return { ok: false, error: SHIFT_GONE_MESSAGE.GIVE_SHIFT };
  }
  if (request.kind === "SWAP") {
    if (
      !request.receiveShift ||
      request.receiveShift.status !== "ASSIGNED" ||
      request.receiveShift.assignedWorkerId !== request.targetUserId
    ) {
      return { ok: false, error: SHIFT_GONE_MESSAGE.RECEIVE_SHIFT };
    }
  }

  const admin = await db.user.findUnique({ where: { id: actor.id }, select: { name: true } });
  const approverName = admin?.name ?? "Admin";
  const acceptedByName = firstName(request.targetUser.name);
  const action = SWAP_REASSIGNED_ACTION[request.kind];
  const now = new Date();

  // One entry per shift changing hands: the shift, who must still hold it,
  // who receives it, and the audit line.
  const moves = [
    {
      shiftId: request.giveShiftId,
      from: request.requesterId,
      to: request.targetUserId,
      missing: "GIVE_SHIFT" as const,
      details: buildSwapReassignmentDetails({
        fromName: request.requester.name,
        toName: request.targetUser.name,
        acceptedByName,
        approvedByName: approverName,
      }),
    },
    ...(request.kind === "SWAP" && request.receiveShift
      ? [
          {
            shiftId: request.receiveShift.id,
            from: request.targetUserId,
            to: request.requesterId,
            missing: "RECEIVE_SHIFT" as const,
            details: buildSwapReassignmentDetails({
              fromName: request.targetUser.name,
              toName: request.requester.name,
              acceptedByName,
              approvedByName: approverName,
            }),
          },
        ]
      : []),
  ].sort((a, b) => (a.shiftId < b.shiftId ? -1 : 1));

  const outcome = await guardedTransaction<void, ApprovalRollback>(async (tx) => {
    const decided = await tx.shiftSwapRequest.updateMany({
      where: { id: requestId, status: "PENDING_APPROVAL" },
      data: { status: "APPROVED", approvedById: actor.id, approvedAt: now },
    });
    if (decided.count !== 1) throw new Rollback("DECIDED");

    for (const move of moves) {
      const moved = await tx.shift.updateMany({
        where: { id: move.shiftId, status: "ASSIGNED", assignedWorkerId: move.from },
        data: { assignedWorkerId: move.to, version: { increment: 1 } },
      });
      if (moved.count !== 1) throw new Rollback(move.missing);
      await tx.shiftActivity.create({
        data: { shiftId: move.shiftId, actorId: actor.id, action, details: move.details },
      });
    }
  });
  if (!outcome.ok) {
    return {
      ok: false,
      error: outcome.result === "DECIDED" ? await describeDecidedRequest(requestId) : SHIFT_GONE_MESSAGE[outcome.result],
    };
  }

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

/** Terminal, no `Shift` row is touched. Conditional, so it can't overwrite an approval. */
export async function denyShiftSwapRequest(requestId: string): Promise<SwapApprovalResult> {
  const actor = await requireActor("ADMIN");
  const { request, error } = await loadPendingApproval(requestId);
  if (!request) return { ok: false, error: error! };

  const admin = await db.user.findUnique({ where: { id: actor.id }, select: { name: true } });
  const approverName = admin?.name ?? "Admin";

  const decided = await db.shiftSwapRequest.updateMany({
    where: { id: requestId, status: "PENDING_APPROVAL" },
    data: { status: "DENIED", approvedById: actor.id, approvedAt: new Date() },
  });
  if (decided.count !== 1) return { ok: false, error: await describeDecidedRequest(requestId) };

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
