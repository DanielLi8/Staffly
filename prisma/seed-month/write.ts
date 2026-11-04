/**
 * Loads what `planMonth` needs, makes sure the demo roster exists, and
 * replaces the month's generated rows in one transaction.
 *
 * Idempotent: every row the generator writes has an id starting with
 * `monthPrefix(month)`, and a run deletes exactly those rows before inserting
 * the new plan, so re-running for a month never duplicates anything and never
 * touches a row it didn't make (other months, the base seed, anything created
 * in the app). Deleting a generated shift cascades to whatever hangs off it -
 * including bids or swap requests someone made on it in the app since.
 * Demo staff (`./roster.ts`) are upserted by email and never deleted.
 */
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { schedulePolicyFor } from "@/lib/schedule-rules";
import { addDaysToKey, hospitalInstant } from "@/lib/timezone";
import { monthPrefix, planMonth, type MonthPlan, type PlanStaff } from "./plan";
import { planDemoRoster } from "./roster";

export const DEMO_STAFF_PASSWORD = "worker123";

export interface SeedMonthResult {
  plan: MonthPlan;
  demoStaffCreated: number;
  deleted: number;
}

export async function seedMonth(db: PrismaClient, opts: { month: string; now: Date }): Promise<SeedMonthResult> {
  const { month, now } = opts;
  const prefix = monthPrefix(month);

  const hospital = await db.hospital.findFirst({ orderBy: { createdAt: "asc" } });
  const admins = await db.user.findMany({
    where: { role: "ADMIN" },
    orderBy: [{ createdAt: "asc" }, { email: "asc" }],
    select: { id: true, name: true },
  });
  const departments = await db.department.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
  if (departments.length === 0) throw new Error("No departments - run `pnpm prisma db seed` first.");

  const demoStaffCreated = await ensureDemoRoster(db, departments, hospital?.id ?? null);

  const staffRows = await db.user.findMany({
    where: { role: "STAFF", departmentMemberships: { some: {} } },
    orderBy: { email: "asc" },
    include: { departmentMemberships: { select: { departmentId: true } } },
  });
  const staff: PlanStaff[] = staffRows.map((u) => ({
    id: u.id,
    name: u.name,
    position: u.position,
    isTeamLead: u.isTeamLead,
    departmentIds: u.departmentMemberships.map((m) => m.departmentId).sort(),
    phoneVerified: Boolean(u.phone && u.phoneVerifiedAt),
    seniorityRank: u.seniorityRank,
    hireDate: u.hireDate,
  }));

  // A window around the month wide enough for pay periods, rest gaps and streaks.
  const windowStart = hospitalInstant(addDaysToKey(`${month}-01`, -21));
  const windowEnd = hospitalInstant(addDaysToKey(`${month}-01`, 52));
  const notOwned = { NOT: { id: { startsWith: prefix } } };
  const occupied = await db.shift.findMany({
    where: {
      ...notOwned,
      assignedWorkerId: { in: staff.map((s) => s.id) },
      status: { not: "CANCELLED" },
      startsAt: { lt: windowEnd },
      endsAt: { gt: windowStart },
    },
    select: { assignedWorkerId: true, startsAt: true, endsAt: true },
  });
  const existingAvailability = await db.availability.findMany({
    where: { ...notOwned, startsAt: { lt: windowEnd }, endsAt: { gt: windowStart } },
    select: { userId: true, startsAt: true, endsAt: true, status: true },
  });
  const taken = await db.shift.findMany({ where: { ...notOwned, smsCode: { not: null } }, select: { smsCode: true } });

  const plan = planMonth({
    month,
    now,
    hospitalId: hospital?.id ?? null,
    policy: schedulePolicyFor(hospital),
    admins,
    departments: departments.map((d) => ({ id: d.id, code: d.code, name: d.name })),
    staff,
    occupied: occupied.map((o) => ({ userId: o.assignedWorkerId!, startsAt: o.startsAt, endsAt: o.endsAt })),
    existingAvailability,
    takenSmsCodes: new Set(taken.map((t) => t.smsCode!)),
  });

  const deleted = await db.$transaction(
    async (tx) => {
      const owned = { where: { id: { startsWith: prefix } } };
      // Shifts cascade to their bids, activity, campaign, outreach, declines and swap requests.
      let deletedRows = 0;
      deletedRows += (await tx.notification.deleteMany(owned)).count;
      deletedRows += (await tx.availability.deleteMany(owned)).count;
      deletedRows += (await tx.shiftSwapRequest.deleteMany(owned)).count;
      deletedRows += (await tx.shift.deleteMany(owned)).count;

      await tx.shift.createMany({ data: plan.shifts });
      await tx.calloutCampaign.createMany({ data: plan.campaigns });
      await tx.shiftBid.createMany({ data: plan.bids });
      await tx.shiftActivity.createMany({ data: plan.activities });
      await tx.outreachAttempt.createMany({ data: plan.outreach });
      await tx.shiftDecline.createMany({ data: plan.declines });
      await tx.shiftSwapRequest.createMany({ data: plan.swaps });
      await tx.availability.createMany({ data: plan.availability });
      await tx.notification.createMany({ data: plan.notifications });
      return deletedRows;
    },
    { timeout: 120_000, maxWait: 10_000 }
  );

  return { plan, demoStaffCreated, deleted };
}

async function ensureDemoRoster(
  db: PrismaClient,
  departments: Array<{ id: string; code: string; name: string }>,
  hospitalId: string | null
): Promise<number> {
  const members = await db.departmentMembership.findMany({
    where: { user: { role: "STAFF" } },
    select: { departmentId: true, user: { select: { position: true, isTeamLead: true } } },
  });
  const names = await db.user.findMany({ select: { name: true } });
  const specs = planDemoRoster(
    departments,
    members.map((m) => ({ departmentId: m.departmentId, position: m.user.position, isTeamLead: m.user.isTeamLead })),
    new Set(names.map((n) => n.name))
  );
  if (specs.length === 0) return 0;

  const password = await bcrypt.hash(DEMO_STAFF_PASSWORD, 10);
  let created = 0;
  for (const spec of specs) {
    const existing = await db.user.findUnique({ where: { email: spec.email } });
    const user =
      existing ??
      (await db.user.create({
        data: {
          email: spec.email,
          name: spec.name,
          password,
          role: "STAFF",
          department: spec.departmentName,
          position: spec.position,
          isTeamLead: spec.isTeamLead,
          hireDate: spec.hireDate,
          hospitalId,
        },
      }));
    if (!existing) created++;
    await db.departmentMembership.upsert({
      where: { departmentId_userId: { departmentId: spec.departmentId, userId: user.id } },
      update: {},
      create: { departmentId: spec.departmentId, userId: user.id, title: spec.title },
    });
  }
  return created;
}
