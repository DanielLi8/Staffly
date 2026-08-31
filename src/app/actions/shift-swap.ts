"use server";

import { addDays } from "date-fns";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth";
import { payPeriodFor, isSamePayPeriod, PAY_PERIOD_LENGTH_DAYS } from "@/lib/shift-swap/pay-period";
import { evaluateReceivingEligibility, type EligibilityShift } from "@/lib/shift-swap/eligibility";
import { revalidatePath } from "next/cache";

/**
 * Requester-side Shift Swap / Giveaway flow (foundation phase only). This
 * file only ever creates a `ShiftSwapRequest` in PENDING_ACCEPT - it never
 * touches `Shift.assignedWorkerId`. The receiving colleague's accept/reject,
 * the manager's approve/deny, and the resulting reassignment are the
 * `staffly-shift-swap-accept-approve` follow-up task's job.
 *
 * A generous ± one pay-period window (rather than an exact hospital-timezone
 * instant range) is used everywhere shifts are queried for eligibility
 * projection - the pure functions in `@/lib/shift-swap` decide the real
 * boundary from the data, matching the DB-layer/pure-layer split
 * `src/lib/callout/tiers.ts` already uses (load a generous candidate pool,
 * let the pure function decide).
 */

const ELIGIBILITY_WINDOW_DAYS = PAY_PERIOD_LENGTH_DAYS;

function toEligibilityShifts(shifts: { id: string; startsAt: Date; endsAt: Date }[]): EligibilityShift[] {
  return shifts.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt }));
}

export interface GiveableShift {
  id: string;
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  unit: string;
  roleNeeded: string;
  startsAt: Date;
  endsAt: Date;
}

/** Step 1: the requester's own upcoming ASSIGNED shifts in the CURRENT pay period. */
export async function listMyGiveableShifts(): Promise<GiveableShift[]> {
  const actor = await requireActor("STAFF");
  const now = new Date();
  const period = payPeriodFor(now);

  const shifts = await db.shift.findMany({
    where: {
      assignedWorkerId: actor.id,
      status: "ASSIGNED",
      startsAt: { gt: now, lte: addDays(period.end, 1) },
    },
    include: { department: { select: { name: true, code: true } } },
    orderBy: { startsAt: "asc" },
  });

  return shifts
    .filter((s) => isSamePayPeriod(s.startsAt, now))
    .map((s) => ({
      id: s.id,
      departmentId: s.departmentId,
      departmentName: s.department.name,
      departmentCode: s.department.code,
      unit: s.unit,
      roleNeeded: s.roleNeeded,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
    }));
}

async function loadOwnGiveShift(actorId: string, giveShiftId: string) {
  const giveShift = await db.shift.findUnique({ where: { id: giveShiftId } });
  if (!giveShift || giveShift.assignedWorkerId !== actorId || giveShift.status !== "ASSIGNED") {
    return null;
  }
  return giveShift;
}

/** Every OTHER department member's shifts near `giveShift`'s pay period, for eligibility projection. */
async function loadDepartmentShiftsNear(departmentId: string, around: Date, excludeUserId: string) {
  return db.shift.findMany({
    where: {
      departmentId,
      status: "ASSIGNED",
      assignedWorkerId: { not: excludeUserId },
      startsAt: { gte: addDays(around, -ELIGIBILITY_WINDOW_DAYS), lte: addDays(around, ELIGIBILITY_WINDOW_DAYS) },
    },
    include: { assignedWorker: { select: { id: true, name: true, position: true } } },
    orderBy: { startsAt: "asc" },
  });
}

export interface SwapCandidateEntry {
  /** The candidate's own shift being offered back - this becomes `receiveShiftId` if selected. */
  shiftId: string;
  userId: string;
  userName: string;
  startsAt: Date;
  endsAt: Date;
  eligible: boolean;
  blockedReason: string | null;
}

/**
 * Step 2 for SWAP: every OTHER department member's shift in the same pay
 * period as `giveShift`, each annotated with whether that colleague could
 * eligibly receive `giveShift` in exchange. Eligibility is projected against
 * the colleague's schedule with THIS row's own shift removed (it's the one
 * they'd be trading away), so a straight swap of two same-length shifts on
 * different days never spuriously trips the hour or consecutive-day rule.
 */
export async function listUnitSwapCandidates(giveShiftId: string): Promise<SwapCandidateEntry[]> {
  const actor = await requireActor("STAFF");
  const giveShift = await loadOwnGiveShift(actor.id, giveShiftId);
  if (!giveShift) return [];

  const deptShifts = await loadDepartmentShiftsNear(giveShift.departmentId, giveShift.startsAt, actor.id);
  const inPeriod = deptShifts.filter((s) => isSamePayPeriod(s.startsAt, giveShift.startsAt));

  const byUser = new Map<string, typeof deptShifts>();
  for (const s of deptShifts) {
    if (!s.assignedWorkerId) continue;
    const list = byUser.get(s.assignedWorkerId) ?? [];
    list.push(s);
    byUser.set(s.assignedWorkerId, list);
  }

  const newShift: EligibilityShift = { id: giveShift.id, startsAt: giveShift.startsAt, endsAt: giveShift.endsAt };

  // assignedWorkerId is always set on an ASSIGNED shift by convention, but the
  // schema doesn't enforce it - skip rather than surface a broken row for the
  // rare shift that violates that invariant.
  return inPeriod
    .filter((row): row is typeof row & { assignedWorkerId: string; assignedWorker: NonNullable<typeof row.assignedWorker> } =>
      Boolean(row.assignedWorkerId && row.assignedWorker)
    )
    .map((row) => {
      const candidateShifts = toEligibilityShifts(byUser.get(row.assignedWorkerId) ?? []).filter(
        (s) => s.id !== row.id
      );
      const result = evaluateReceivingEligibility(newShift, candidateShifts);
      return {
        shiftId: row.id,
        userId: row.assignedWorkerId,
        userName: row.assignedWorker.name,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        eligible: result.eligible,
        blockedReason: result.message,
      };
    });
}

export interface GiveawayCandidateEntry {
  userId: string;
  userName: string;
  position: string | null;
  eligible: boolean;
  blockedReason: string | null;
}

/**
 * Step 2 for GIVEAWAY: a flat list of department colleagues (no shift
 * received back), each annotated with whether they could eligibly pick up
 * `giveShift` as-is. `search` filters by name.
 */
export async function listUnitGiveawayCandidates(
  giveShiftId: string,
  search?: string
): Promise<GiveawayCandidateEntry[]> {
  const actor = await requireActor("STAFF");
  const giveShift = await loadOwnGiveShift(actor.id, giveShiftId);
  if (!giveShift) return [];

  const q = search?.trim();
  const memberships = await db.departmentMembership.findMany({
    where: {
      departmentId: giveShift.departmentId,
      userId: { not: actor.id },
      ...(q ? { user: { name: { contains: q, mode: "insensitive" } } } : {}),
    },
    include: { user: { select: { id: true, name: true, position: true, role: true } } },
  });

  const candidates = memberships.filter((m) => m.user.role === "STAFF");
  const deptShifts = await loadDepartmentShiftsNear(giveShift.departmentId, giveShift.startsAt, actor.id);

  const byUser = new Map<string, typeof deptShifts>();
  for (const s of deptShifts) {
    if (!s.assignedWorkerId) continue;
    const list = byUser.get(s.assignedWorkerId) ?? [];
    list.push(s);
    byUser.set(s.assignedWorkerId, list);
  }

  const newShift: EligibilityShift = { id: giveShift.id, startsAt: giveShift.startsAt, endsAt: giveShift.endsAt };

  return candidates.map((m) => {
    const existing = toEligibilityShifts(byUser.get(m.user.id) ?? []);
    const result = evaluateReceivingEligibility(newShift, existing);
    return {
      userId: m.user.id,
      userName: m.user.name,
      position: m.user.position,
      eligible: result.eligible,
      blockedReason: result.message,
    };
  });
}

const createSwapRequestSchema = z.object({
  giveShiftId: z.string().min(1),
  kind: z.enum(["SWAP", "GIVEAWAY"]),
  targetUserId: z.string().min(1),
  receiveShiftId: z.string().min(1).optional(),
});

/**
 * Validation is returned, never thrown - a routine bad input (a colleague who
 * became ineligible between Step 2 and submit, a shift that changed status in
 * another tab) must not surface as Next.js's opaque server-action "digest"
 * message, matching `CreateShiftFailure` (`src/app/actions/shifts.ts`).
 */
export type CreateShiftSwapRequestResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Step 3 submit. Re-validates everything server-side rather than trusting
 * Step 1/2's client-held data, since time has passed and another tab or the
 * colleague's own schedule could have changed underneath: give-shift
 * ownership, same-department targeting, same-pay-period, and the exact
 * receiving-eligibility rule Step 2 already showed. Creates the
 * `ShiftSwapRequest` in PENDING_ACCEPT only - no `Shift` row is touched.
 */
export async function createShiftSwapRequest(rawInput: unknown): Promise<CreateShiftSwapRequestResult> {
  const actor = await requireActor("STAFF");

  const parsed = createSwapRequestSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request." };
  }
  const { giveShiftId, kind, targetUserId, receiveShiftId } = parsed.data;

  if (targetUserId === actor.id) {
    return { ok: false, error: "You can't send a request to yourself." };
  }

  const giveShift = await loadOwnGiveShift(actor.id, giveShiftId);
  if (!giveShift) {
    return { ok: false, error: "That shift is no longer available to give up." };
  }

  const targetMembership = await db.departmentMembership.findUnique({
    where: { departmentId_userId: { departmentId: giveShift.departmentId, userId: targetUserId } },
  });
  const targetUser = await db.user.findUnique({ where: { id: targetUserId } });
  if (!targetMembership || !targetUser || targetUser.role !== "STAFF") {
    return { ok: false, error: "That person isn't in your unit." };
  }

  const activeExisting = await db.shiftSwapRequest.findFirst({
    where: { giveShiftId, status: { in: ["PENDING_ACCEPT", "ACCEPTED", "PENDING_APPROVAL"] } },
  });
  if (activeExisting) {
    return { ok: false, error: "This shift already has a pending swap request." };
  }

  let receiveShift: { id: string; startsAt: Date; endsAt: Date } | null = null;
  if (kind === "SWAP") {
    if (!receiveShiftId) {
      return { ok: false, error: "Pick a shift to receive in exchange." };
    }
    const candidate = await db.shift.findUnique({ where: { id: receiveShiftId } });
    if (!candidate || candidate.assignedWorkerId !== targetUserId || candidate.status !== "ASSIGNED") {
      return { ok: false, error: "That shift is no longer available." };
    }
    if (!isSamePayPeriod(candidate.startsAt, giveShift.startsAt)) {
      return { ok: false, error: "Both shifts must fall in the same pay period." };
    }
    receiveShift = candidate;
  } else if (receiveShiftId) {
    return { ok: false, error: "Invalid request." };
  }

  const deptShifts = await loadDepartmentShiftsNear(giveShift.departmentId, giveShift.startsAt, actor.id);
  const targetExisting = toEligibilityShifts(deptShifts.filter((s) => s.assignedWorkerId === targetUserId)).filter(
    (s) => s.id !== receiveShift?.id
  );
  const newShift: EligibilityShift = { id: giveShift.id, startsAt: giveShift.startsAt, endsAt: giveShift.endsAt };
  const eligibility = evaluateReceivingEligibility(newShift, targetExisting);
  if (!eligibility.eligible) {
    return { ok: false, error: `${targetUser.name} ${eligibility.message}.` };
  }

  const created = await db.shiftSwapRequest.create({
    data: {
      requesterId: actor.id,
      giveShiftId: giveShift.id,
      kind,
      targetUserId,
      receiveShiftId: receiveShift?.id ?? null,
      status: "PENDING_ACCEPT",
    },
  });

  revalidatePath("/worker/schedule");

  return { ok: true, id: created.id };
}
