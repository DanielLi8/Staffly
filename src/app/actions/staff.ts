"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { AuthorizationError } from "@/lib/authz";
import { canManageStaffAccounts } from "@/lib/authz/staff-accounts";
import { writeAudit } from "@/lib/audit";
import {
  STAFF_MESSAGES,
  validateStaffInput,
  type StaffFieldErrors,
  type StaffFormInput,
  type StaffRecord,
} from "@/lib/staff/validation";
import { DEACTIVATION_REASONS, type UpcomingShift } from "@/lib/staff/accounts";

/**
 * The Staff page's writes (`/admin/workers`). Every ADMIN may edit a staff
 * record - position, seniority, phone, Team Lead, department memberships.
 * Adding, deactivating and reactivating an account is gated by
 * `canManageStaffAccounts` (System Admins only, captain 2026-10-25).
 *
 * Routine bad input and races come back as typed results, never throws (a
 * thrown server-action error reaches the user as an opaque digest). Auth
 * failures still throw. Every change writes an `AuditLog` row in the same
 * transaction.
 */

export type StaffActionResult =
  | { ok: true; id: string }
  | { ok: false; fieldErrors: StaffFieldErrors; formError?: string };

const formSchema = z.object({
  name: z.string(),
  email: z.string().optional(),
  employeeId: z.string(),
  position: z.string(),
  primaryDepartmentId: z.string(),
  hireDate: z.string(),
  seniorityRank: z.string(),
  phone: z.string(),
  phoneConfirmed: z.boolean(),
  isTeamLead: z.boolean(),
  memberships: z.array(z.object({ departmentId: z.string().min(1), title: z.string() })).max(50),
});

const INVALID_REQUEST: StaffActionResult = {
  ok: false,
  fieldErrors: {},
  formError: "Something in the form couldn't be read. Reload the page and try again.",
};
const NOT_FOUND: StaffActionResult = {
  ok: false,
  fieldErrors: {},
  formError: "This staff member no longer exists.",
};

async function requireStaffAccountManager(): Promise<Session> {
  const session = await requireAuth("ADMIN");
  const allowed = canManageStaffAccounts({
    id: session.user.id,
    role: session.user.role,
    email: session.user.email,
  });
  if (!allowed) throw new AuthorizationError("FORBIDDEN");
  return session;
}

function revalidateStaff(userId?: string) {
  revalidatePath("/admin/workers");
  if (userId) revalidatePath(`/admin/workers/${userId}`);
}

/**
 * The cross-row checks validation can't do alone: every department exists,
 * and the employee ID / a number about to be verified isn't someone else's.
 * (A verified number is how an inbound SMS finds its sender, so two people
 * can never share one.)
 */
async function checkAgainstOthers(
  record: StaffRecord,
  phoneWillBeVerified: boolean,
  selfId: string | null
): Promise<StaffFieldErrors> {
  const errors: StaffFieldErrors = {};
  const notSelf = selfId ? { id: { not: selfId } } : {};

  const departmentIds = record.memberships.map((m) => m.departmentId);
  if (departmentIds.length > 0) {
    const found = await db.department.count({ where: { id: { in: departmentIds } } });
    if (found !== departmentIds.length) errors.memberships = STAFF_MESSAGES.membershipUnknownDepartment;
  }
  if (record.employeeId) {
    const taken = await db.user.findFirst({ where: { employeeId: record.employeeId, ...notSelf }, select: { id: true } });
    if (taken) errors.employeeId = STAFF_MESSAGES.employeeIdTaken;
  }
  if (record.phone && phoneWillBeVerified) {
    const taken = await db.user.findFirst({
      where: { phone: record.phone, phoneVerifiedAt: { not: null }, ...notSelf },
      select: { id: true },
    });
    if (taken) errors.phone = STAFF_MESSAGES.phoneTaken;
  }
  return errors;
}

/** A unique-constraint race the pre-checks lost, mapped back onto its field. */
function uniqueViolation(err: unknown): StaffFieldErrors | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return null;
  const target = String((err.meta as { target?: unknown } | undefined)?.target ?? "");
  if (target.includes("email")) return { email: STAFF_MESSAGES.emailTaken };
  if (target.includes("employeeId")) return { employeeId: STAFF_MESSAGES.employeeIdTaken };
  return null;
}

async function primaryDepartmentName(record: StaffRecord): Promise<string | null> {
  if (!record.primaryDepartmentId) return null;
  const dept = await db.department.findUnique({ where: { id: record.primaryDepartmentId }, select: { name: true } });
  return dept?.name ?? null;
}

/** Add a new hire. They have no password until the set-password invite flow ships. */
export async function createStaffMember(raw: unknown): Promise<StaffActionResult> {
  const session = await requireStaffAccountManager();

  const parsed = formSchema.safeParse(raw);
  if (!parsed.success) return INVALID_REQUEST;
  const validation = validateStaffInput(parsed.data as StaffFormInput, { requireEmail: true });
  if (!validation.ok) return { ok: false, fieldErrors: validation.fieldErrors };
  const record = validation.record;

  const errors = await checkAgainstOthers(record, record.phoneConfirmed, null);
  const emailTaken = await db.user.findUnique({ where: { email: record.email! }, select: { id: true } });
  if (emailTaken) errors.email = STAFF_MESSAGES.emailTaken;
  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };

  const actor = await db.user.findUnique({ where: { id: session.user.id }, select: { hospitalId: true } });
  const department = await primaryDepartmentName(record);

  try {
    const created = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: record.name,
          email: record.email!,
          password: null,
          role: "STAFF",
          employeeId: record.employeeId,
          position: record.position,
          department,
          hireDate: record.hireDate,
          seniorityRank: record.seniorityRank,
          phone: record.phone,
          phoneVerifiedAt: record.phoneConfirmed ? new Date() : null,
          isTeamLead: record.isTeamLead,
          hospitalId: actor?.hospitalId ?? null,
          departmentMemberships: { create: record.memberships },
        },
        select: { id: true },
      });
      await writeAudit(tx, {
        actorId: session.user.id,
        action: "STAFF_CREATED",
        targetType: "User",
        targetId: user.id,
        hospitalId: actor?.hospitalId,
        metadata: {
          name: record.name,
          email: record.email,
          position: record.position,
          departmentIds: record.memberships.map((m) => m.departmentId),
        },
      });
      return user;
    });
    revalidateStaff(created.id);
    return { ok: true, id: created.id };
  } catch (err) {
    const fieldErrors = uniqueViolation(err);
    if (fieldErrors) return { ok: false, fieldErrors };
    throw err;
  }
}

/** Edit a staff record: profile fields, phone, Team Lead and department memberships. */
export async function updateStaffMember(userId: string, raw: unknown): Promise<StaffActionResult> {
  const session = await requireAuth("ADMIN");

  const parsed = formSchema.safeParse(raw);
  if (typeof userId !== "string" || !userId || !parsed.success) return INVALID_REQUEST;
  const validation = validateStaffInput(parsed.data as StaffFormInput, { requireEmail: false });
  if (!validation.ok) return { ok: false, fieldErrors: validation.fieldErrors };
  const record = validation.record;

  const existing = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      hospitalId: true,
      phone: true,
      phoneVerifiedAt: true,
      departmentMemberships: { select: { departmentId: true, title: true } },
    },
  });
  if (!existing || existing.role !== "STAFF") return NOT_FOUND;

  // Unticking "confirmed" un-verifies; ticking it (or keeping it on an
  // unchanged, already-verified number) verifies. A new number is never
  // carried over as verified unless the admin confirmed it.
  const samePhone = record.phone !== null && record.phone === existing.phone;
  const phoneVerifiedAt = !record.phoneConfirmed
    ? null
    : samePhone && existing.phoneVerifiedAt
      ? existing.phoneVerifiedAt
      : new Date();

  const errors = await checkAgainstOthers(record, phoneVerifiedAt !== null, userId);
  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };

  const department = await primaryDepartmentName(record);
  const wanted = new Map(record.memberships.map((m) => [m.departmentId, m.title]));
  const removed = existing.departmentMemberships.filter((m) => !wanted.has(m.departmentId));

  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          name: record.name,
          employeeId: record.employeeId,
          position: record.position,
          department,
          hireDate: record.hireDate,
          seniorityRank: record.seniorityRank,
          phone: record.phone,
          phoneVerifiedAt,
          isTeamLead: record.isTeamLead,
        },
      });
      if (removed.length > 0) {
        await tx.departmentMembership.deleteMany({
          where: { userId, departmentId: { in: removed.map((m) => m.departmentId) } },
        });
      }
      for (const m of record.memberships) {
        await tx.departmentMembership.upsert({
          where: { departmentId_userId: { departmentId: m.departmentId, userId } },
          update: { title: m.title },
          create: { departmentId: m.departmentId, userId, title: m.title },
        });
      }
      await writeAudit(tx, {
        actorId: session.user.id,
        action: "STAFF_UPDATED",
        targetType: "User",
        targetId: userId,
        hospitalId: existing.hospitalId,
        metadata: {
          position: record.position,
          seniorityRank: record.seniorityRank,
          isTeamLead: record.isTeamLead,
          phoneVerified: phoneVerifiedAt !== null,
          memberships: record.memberships.map((m) => ({ departmentId: m.departmentId, title: m.title })),
          removedDepartmentIds: removed.map((m) => m.departmentId),
        },
      });
    });
  } catch (err) {
    const fieldErrors = uniqueViolation(err);
    if (fieldErrors) return { ok: false, fieldErrors };
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      // A department deleted between the check and the write.
      return { ok: false, fieldErrors: { memberships: STAFF_MESSAGES.membershipUnknownDepartment } };
    }
    throw err;
  }

  revalidateStaff(userId);
  return { ok: true, id: userId };
}

export type DeactivateStaffResult =
  | { ok: true; bidsWithdrawn: number; swapRequestsCancelled: number }
  | { ok: false; reason: "NOT_FOUND" | "ALREADY_DEACTIVATED" | "INVALID_REASON" }
  | { ok: false; reason: "HAS_UPCOMING_SHIFTS"; shifts: UpcomingShift[] };

const deactivateSchema = z.object({
  userId: z.string().min(1),
  reason: z.enum(DEACTIVATION_REASONS),
});

/** Shifts still assigned to `userId` that haven't ended - the deactivation blocker. */
async function upcomingAssignedShifts(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date
): Promise<UpcomingShift[]> {
  const shifts = await tx.shift.findMany({
    where: { assignedWorkerId: userId, status: "ASSIGNED", endsAt: { gt: now } },
    orderBy: { startsAt: "asc" },
    select: { id: true, startsAt: true, endsAt: true, department: { select: { name: true } } },
  });
  return shifts.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, departmentName: s.department.name }));
}

/**
 * Deactivate an account (never a hard delete). Refused while they still hold
 * upcoming assigned shifts: silently leaving a shift "covered" by someone who
 * can't come, or silently reopening it, are both worse than asking the admin
 * to deal with those shifts first. On success, in one transaction: sign-in is
 * refused from now on, their pending bids are withdrawn and their open swap /
 * giveaway requests (either side) are cancelled. The cascade, every bid channel
 * and the swap pickers skip a deactivated account from then on.
 */
export async function deactivateStaffMember(raw: unknown): Promise<DeactivateStaffResult> {
  const session = await requireStaffAccountManager();
  const parsed = deactivateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "INVALID_REASON" };
  const { userId, reason } = parsed.data;

  const target = await db.user.findUnique({ where: { id: userId }, select: { role: true, hospitalId: true } });
  if (!target || target.role !== "STAFF") return { ok: false, reason: "NOT_FOUND" };

  const result = await db.$transaction(async (tx): Promise<DeactivateStaffResult> => {
    const now = new Date();
    const shifts = await upcomingAssignedShifts(tx, userId, now);
    if (shifts.length > 0) return { ok: false, reason: "HAS_UPCOMING_SHIFTS", shifts };

    // Conditional, so two admins deactivating at once write one audit row.
    const flipped = await tx.user.updateMany({
      where: { id: userId, deactivatedAt: null },
      data: { deactivatedAt: now, deactivationReason: reason },
    });
    if (flipped.count === 0) return { ok: false, reason: "ALREADY_DEACTIVATED" };

    const bids = await tx.shiftBid.deleteMany({ where: { workerId: userId, status: "PENDING" } });
    const swaps = await tx.shiftSwapRequest.updateMany({
      where: {
        OR: [{ requesterId: userId }, { targetUserId: userId }],
        status: { in: ["PENDING_ACCEPT", "ACCEPTED", "PENDING_APPROVAL"] },
      },
      data: { status: "CANCELLED" },
    });
    await writeAudit(tx, {
      actorId: session.user.id,
      action: "STAFF_DEACTIVATED",
      targetType: "User",
      targetId: userId,
      hospitalId: target.hospitalId,
      metadata: { reason, bidsWithdrawn: bids.count, swapRequestsCancelled: swaps.count },
    });
    return { ok: true, bidsWithdrawn: bids.count, swapRequestsCancelled: swaps.count };
  });

  if (result.ok) revalidateStaff(userId);
  return result;
}

export type ReactivateStaffResult = { ok: true } | { ok: false; reason: "NOT_FOUND" | "NOT_DEACTIVATED" };

/** Restore a deactivated account. Their old password (if any) works again. */
export async function reactivateStaffMember(userId: string): Promise<ReactivateStaffResult> {
  const session = await requireStaffAccountManager();
  if (typeof userId !== "string" || !userId) return { ok: false, reason: "NOT_FOUND" };

  const target = await db.user.findUnique({ where: { id: userId }, select: { role: true, hospitalId: true } });
  if (!target || target.role !== "STAFF") return { ok: false, reason: "NOT_FOUND" };

  const result = await db.$transaction(async (tx): Promise<ReactivateStaffResult> => {
    const flipped = await tx.user.updateMany({
      where: { id: userId, deactivatedAt: { not: null } },
      data: { deactivatedAt: null, deactivationReason: null },
    });
    if (flipped.count === 0) return { ok: false, reason: "NOT_DEACTIVATED" };
    await writeAudit(tx, {
      actorId: session.user.id,
      action: "STAFF_REACTIVATED",
      targetType: "User",
      targetId: userId,
      hospitalId: target.hospitalId,
    });
    return { ok: true };
  });

  if (result.ok) revalidateStaff(userId);
  return result;
}
