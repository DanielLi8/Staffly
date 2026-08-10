/**
 * A small in-memory stand-in for the Prisma client, covering exactly the queries
 * the callout campaign service issues. Lets the DB-authoritative cascade be
 * exercised end to end - start, advance, hold, stop - without a live database.
 *
 * Deliberately narrow: it implements the query SHAPES this code path uses, not
 * Prisma in general. If a new query shape appears, extend it here.
 */
import type { AvailabilityStatus, CampaignStatus, ShiftStatus } from "@prisma/client";

export interface FakeStaff {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  phoneVerifiedAt: Date | null;
  seniorityRank: number | null;
  hireDate: Date | null;
  departmentIds: string[];
  availabilities: { startsAt: Date; endsAt: Date; status: AvailabilityStatus }[];
}

export interface FakeShift {
  id: string;
  title: string;
  unit: string;
  roleNeeded: string;
  departmentId: string;
  departmentName: string;
  status: ShiftStatus;
  startsAt: Date;
  endsAt: Date;
  smsCode: string | null;
  createdById: string;
}

export interface FakeCampaign {
  id: string;
  shiftId: string;
  currentTier: number;
  status: CampaignStatus;
  tier1WindowMinutes: number;
  tier2WindowMinutes: number;
  tier3WindowMinutes: number;
  startedAt: Date;
  /** Non-null while the opening outreach is still held back after posting. */
  tier1DispatchAt: Date | null;
  tier1EnteredAt: Date | null;
  tier2EnteredAt: Date | null;
  tier3EnteredAt: Date | null;
  filledAt: Date | null;
  endedAt: Date | null;
  pastStartReminderAt: Date | null;
}

export interface FakeAttempt {
  shiftId: string;
  tier: number;
  userId: string;
  channel: string;
  status: string;
  providerMessageId: string | null;
  response: string | null;
  respondedAt: Date | null;
}

export interface FakeState {
  shift: FakeShift;
  department: { id: string; name: string; code: string };
  campaign: FakeCampaign | null;
  staff: FakeStaff[];
  attempts: FakeAttempt[];
  activities: { shiftId: string; actorId: string; action: string; details: string }[];
  notifications: { userId: string; type: string; title: string; message: string; shiftId: string }[];
}

export function createFakeState(overrides: Partial<FakeState> = {}): FakeState {
  const shift: FakeShift = {
    id: "shift-1",
    title: "Emergency (ER) – Registered Nurse",
    unit: "4B",
    roleNeeded: "Registered Nurse",
    departmentId: "dept-er",
    departmentName: "Emergency",
    status: "OPEN",
    startsAt: new Date("2026-08-12T11:00:00Z"),
    endsAt: new Date("2026-08-12T19:00:00Z"),
    smsCode: "ER4B",
    createdById: "scheduler-1",
    ...overrides.shift,
  };
  return {
    shift,
    department: overrides.department ?? {
      id: shift.departmentId,
      name: shift.departmentName,
      code: "ER",
    },
    campaign: overrides.campaign ?? null,
    staff: overrides.staff ?? [],
    attempts: overrides.attempts ?? [],
    activities: overrides.activities ?? [],
    notifications: overrides.notifications ?? [],
  };
}

function overlaps(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date }
): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/** Build the fake `db` object. Mutating `state` between calls is the point. */
export function createFakeDb(state: FakeState) {
  let campaignSeq = 0;

  return {
    department: {
      async findUnique({ where }: { where: { id: string } }) {
        return where.id === state.department.id ? state.department : null;
      },
    },

    shift: {
      async findUnique({ where }: { where: { id: string } }) {
        if (where.id !== state.shift.id) return null;
        const s = state.shift;
        return { ...s, department: { name: s.departmentName } };
      },
      async findMany() {
        // Only used by the dashboard's overtime lookup, which these tests do not
        // exercise; an empty result keeps the shape honest.
        return [];
      },
      async create({ data }: { data: Record<string, unknown> }) {
        state.shift = {
          ...state.shift,
          id: (data.id as string) ?? state.shift.id,
          title: data.title as string,
          unit: data.unit as string,
          roleNeeded: data.roleNeeded as string,
          departmentId: data.departmentId as string,
          departmentName: state.department.name,
          status: "OPEN",
          startsAt: data.startsAt as Date,
          endsAt: data.endsAt as Date,
          smsCode: (data.smsCode as string) ?? null,
          createdById: data.createdById as string,
        };
        return { ...state.shift };
      },
    },

    calloutCampaign: {
      async findUnique({ where }: { where: { shiftId: string } }) {
        if (!state.campaign || state.campaign.shiftId !== where.shiftId) return null;
        return {
          ...state.campaign,
          shift: {
            id: state.shift.id,
            status: state.shift.status,
            startsAt: state.shift.startsAt,
            createdById: state.shift.createdById,
            title: state.shift.title,
          },
        };
      },
      async upsert({
        where,
        create,
      }: {
        where: { shiftId: string };
        create: Partial<FakeCampaign> & { shiftId: string };
      }) {
        if (state.campaign && state.campaign.shiftId === where.shiftId) return state.campaign;
        state.campaign = {
          id: `campaign-${++campaignSeq}`,
          shiftId: create.shiftId,
          currentTier: create.currentTier ?? 1,
          status: create.status ?? "RUNNING",
          tier1WindowMinutes: 15,
          tier2WindowMinutes: 20,
          tier3WindowMinutes: 30,
          startedAt: create.startedAt ?? new Date(),
          tier1DispatchAt: create.tier1DispatchAt ?? null,
          tier1EnteredAt: create.tier1EnteredAt ?? null,
          tier2EnteredAt: null,
          tier3EnteredAt: null,
          filledAt: null,
          endedAt: null,
          pastStartReminderAt: null,
        };
        return state.campaign;
      },
      async update({ data }: { where: { shiftId: string }; data: Partial<FakeCampaign> }) {
        if (!state.campaign) throw new Error("no campaign");
        state.campaign = { ...state.campaign, ...data };
        return state.campaign;
      },
      async updateMany({ data }: { where: unknown; data: Partial<FakeCampaign> }) {
        if (!state.campaign) return { count: 0 };
        state.campaign = { ...state.campaign, ...data };
        return { count: 1 };
      },
    },

    user: {
      async findMany({
        select,
      }: {
        where: unknown;
        select: { availabilities: { where: { startsAt: { lt: Date }; endsAt: { gt: Date } } } };
      }) {
        const window = {
          startsAt: select.availabilities.where.endsAt.gt,
          endsAt: select.availabilities.where.startsAt.lt,
        };
        return state.staff.map((s) => ({
          id: s.id,
          name: s.name,
          email: s.email,
          phone: s.phone,
          phoneVerifiedAt: s.phoneVerifiedAt,
          seniorityRank: s.seniorityRank,
          hireDate: s.hireDate,
          departmentMemberships: s.departmentIds.map((departmentId) => ({ departmentId })),
          availabilities: s.availabilities.filter((a) => overlaps(a, window)),
        }));
      },
    },

    outreachAttempt: {
      async findMany({
        where,
      }: {
        where: { shiftId: string; tier: number; userId: { in: string[] } };
      }) {
        return state.attempts.filter(
          (a) =>
            a.shiftId === where.shiftId &&
            a.tier === where.tier &&
            where.userId.in.includes(a.userId)
        );
      },
      async upsert({
        where,
        create,
        update,
      }: {
        where: {
          shiftId_tier_userId_channel: {
            shiftId: string;
            tier: number;
            userId: string;
            channel: string;
          };
        };
        create: Omit<FakeAttempt, "response" | "respondedAt">;
        update: { status: string; providerMessageId: string | null };
      }) {
        const key = where.shiftId_tier_userId_channel;
        const existing = state.attempts.find(
          (a) =>
            a.shiftId === key.shiftId &&
            a.tier === key.tier &&
            a.userId === key.userId &&
            a.channel === key.channel
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row: FakeAttempt = { ...create, response: null, respondedAt: null };
        state.attempts.push(row);
        return row;
      },
      async updateMany() {
        return { count: 0 };
      },
    },

    shiftActivity: {
      async create({
        data,
      }: {
        data: { shiftId: string; actorId: string; action: string; details: string };
      }) {
        state.activities.push(data);
        return data;
      },
    },

    notification: {
      async create({
        data,
      }: {
        data: {
          userId: string;
          type: string;
          title: string;
          message: string;
          shiftId: string;
        };
      }) {
        state.notifications.push(data);
        return data;
      },
    },
  };
}
