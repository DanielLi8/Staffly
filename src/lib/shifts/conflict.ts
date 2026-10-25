/**
 * What to tell the admin who LOST a race on a shift.
 *
 * Every shift write is conditional (`updateMany` on the status/version the
 * caller saw - see `Shift.version`), so when two admins act on one shift at the
 * same moment exactly one write lands. The other gets a typed failure, and this
 * module turns "your write matched 0 rows" into what actually happened, e.g.
 * "This shift was just awarded to Maria Santos by James Okafor."
 *
 * `shiftConflictMessage` is pure; `describeShiftConflict` reads the shift and
 * its latest activity. The winner's activity row is written in the same
 * transaction as its state change, so by the time a loser's conditional write
 * has failed, that row is visible.
 */
import type { ShiftStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { formatShiftRange } from "@/lib/utils";
import { SWAP_REASSIGNED_ACTION } from "@/lib/shift-swap/audit";

/** Activity actions that record a write which bumps `Shift.version`. */
export const SHIFT_CHANGE_ACTIONS = [
  "WORKER_ASSIGNED",
  "SHIFT_CANCELLED",
  "SHIFT_TIME_EDITED",
  SWAP_REASSIGNED_ACTION.SWAP,
  SWAP_REASSIGNED_ACTION.GIVEAWAY,
] as const;

export interface ShiftConflictState {
  status: ShiftStatus;
  startsAt: Date;
  endsAt: Date;
  assigneeName: string | null;
  /** The most recent version-bumping activity, if any. */
  lastChange: { action: string; actorName: string } | null;
}

function by(lastChange: ShiftConflictState["lastChange"], action: string | readonly string[]): string {
  const actions = typeof action === "string" ? [action] : action;
  return lastChange && actions.includes(lastChange.action) ? ` by ${lastChange.actorName}` : "";
}

/** One sentence naming what happened to the shift, and who did it when we know. */
export function shiftConflictMessage(state: ShiftConflictState): string {
  const { status, lastChange } = state;
  if (status === "CANCELLED") {
    return `This shift was just cancelled${by(lastChange, "SHIFT_CANCELLED")}.`;
  }
  if (status === "CLOSED") return "This shift is closed.";

  if (lastChange?.action === "SHIFT_TIME_EDITED") {
    return `${lastChange.actorName} just changed this shift's hours to ${formatShiftRange(state.startsAt, state.endsAt)}.`;
  }
  const swapActions = [SWAP_REASSIGNED_ACTION.SWAP, SWAP_REASSIGNED_ACTION.GIVEAWAY];
  if (status === "ASSIGNED" && lastChange && swapActions.includes(lastChange.action)) {
    return `This shift was just reassigned to ${state.assigneeName ?? "another worker"} by a swap ${lastChange.actorName} approved.`;
  }
  if (status === "ASSIGNED") {
    return `This shift was just awarded to ${state.assigneeName ?? "another worker"}${by(lastChange, "WORKER_ASSIGNED")}.`;
  }
  return lastChange
    ? `This shift was just changed by ${lastChange.actorName}.`
    : "This shift was just changed by someone else.";
}

/** Read the shift's current state and explain it. */
export async function describeShiftConflict(shiftId: string): Promise<string> {
  const shift = await db.shift.findUnique({
    where: { id: shiftId },
    select: {
      status: true,
      startsAt: true,
      endsAt: true,
      assignedWorker: { select: { name: true } },
      activities: {
        where: { action: { in: [...SHIFT_CHANGE_ACTIONS] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { action: true, actor: { select: { name: true } } },
      },
    },
  });
  if (!shift) return "This shift no longer exists.";
  const last = shift.activities[0];
  return shiftConflictMessage({
    status: shift.status,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    assigneeName: shift.assignedWorker?.name ?? null,
    lastChange: last ? { action: last.action, actorName: last.actor.name } : null,
  });
}
