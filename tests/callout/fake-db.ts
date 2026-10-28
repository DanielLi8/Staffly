/**
 * A small in-memory stand-in for the Prisma client, covering exactly the queries
 * the callout campaign service issues. Lets the DB-authoritative cascade be
 * exercised end to end - start, advance, hold, stop - without a live database.
 *
 * Deliberately narrow: it implements the query SHAPES this code path uses, not
 * Prisma in general. If a new query shape appears, extend it here.
 */
import { Prisma, type AvailabilityStatus, type CampaignStatus, type ShiftStatus } from "@prisma/client";

export interface FakeStaff {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  phoneVerifiedAt: Date | null;
  /** Base clinical position, matched against `Shift.roleNeeded`. */
  position: string | null;
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

export interface FakeBid {
  shiftId: string;
  workerId: string;
  note: string | null;
  durationScope: string;
  partialStartsAt: Date | null;
  partialEndsAt: Date | null;
  status: string;
}

export interface FakeDecline {
  shiftId: string;
  userId: string;
  source: string;
}

export interface FakeState {
  shift: FakeShift;
  department: { id: string; name: string; code: string };
  campaign: FakeCampaign | null;
  staff: FakeStaff[];
  /** ADMIN user ids - the audience for "new bid" notifications. */
  admins: string[];
  attempts: FakeAttempt[];
  bids: FakeBid[];
  declines: FakeDecline[];
  activities: { shiftId: string; actorId: string; action: string; details: string }[];
  notifications: { userId: string; type: string; title: string; message: string; shiftId: string }[];
}

export function createFakeState(
  overrides: Partial<Omit<FakeState, "shift">> & { shift?: Partial<FakeShift> } = {}
): FakeState {
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
    admins: overrides.admins ?? [shift.createdById],
    attempts: overrides.attempts ?? [],
    bids: overrides.bids ?? [],
    declines: overrides.declines ?? [],
    activities: overrides.activities ?? [],
    notifications: overrides.notifications ?? [],
  };
}

/** The subset of a Prisma `where` on CalloutCampaign that the service uses. */
function campaignMatches(
  campaign: FakeCampaign,
  where: { shiftId?: string; status?: CampaignStatus | { in: CampaignStatus[] }; endedAt?: null }
): boolean {
  if (where.shiftId !== undefined && campaign.shiftId !== where.shiftId) return false;
  if (where.status !== undefined) {
    const allowed = typeof where.status === "string" ? [where.status] : where.status.in;
    if (!allowed.includes(campaign.status)) return false;
  }
  if (where.endedAt === null && campaign.endedAt !== null) return false;
  return true;
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
  // Inbound-webhook de-duplication (`handleWebhookOnce`): key -> stored TwiML.
  const processedWebhooks = new Map<string, string | null>();

  const fakeDb = {
    // Interactive transactions run straight against the fake (no rollback).
    async $transaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      return fn(fakeDb as never);
    },

    department: {
      async findUnique({ where }: { where: { id: string } }) {
        return where.id === state.department.id ? state.department : null;
      },
    },

    shift: {
      async findUnique({ where }: { where: { id?: string; smsCode?: string } }) {
        const s = state.shift;
        if (where.id !== undefined ? where.id !== s.id : where.smsCode !== s.smsCode) return null;
        return {
          ...s,
          department: { name: s.departmentName },
          campaign: state.campaign ? { status: state.campaign.status } : null,
        };
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
      async updateMany({
        where,
        data,
      }: {
        where: Parameters<typeof campaignMatches>[1];
        data: Partial<FakeCampaign>;
      }) {
        if (!state.campaign || !campaignMatches(state.campaign, where)) return { count: 0 };
        state.campaign = { ...state.campaign, ...data };
        return { count: 1 };
      },
    },

    user: {
      async findUnique({ where }: { where: { id: string } }) {
        const s = state.staff.find((u) => u.id === where.id);
        return s ? { name: s.name, position: s.position } : null;
      },
      async findFirst({ where }: { where: { phone: string } }) {
        const s = state.staff.find((u) => u.phone === where.phone && u.phoneVerifiedAt !== null);
        return s ? { id: s.id } : null;
      },
      async findMany({
        where,
        select,
      }: {
        where: { role?: string };
        select: { availabilities?: { where: { startsAt: { lt: Date }; endsAt: { gt: Date } } } };
      }) {
        if (where.role === "ADMIN") return state.admins.map((id) => ({ id }));
        if (!select.availabilities) throw new Error("fake-db: unsupported user.findMany");
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
          position: s.position,
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
        where:
          | { shiftId: string; tier: number; userId: { in: string[] } }
          | { userId: string; channel: string; response: null };
      }) {
        if (!("shiftId" in where)) {
          // outstandingSmsCallouts: unanswered texts about a still-biddable,
          // undeclined shift (the fake holds one shift).
          const s = state.shift;
          const biddable = s.status === "OPEN" && s.endsAt > new Date();
          const declined = state.declines.some((d) => d.shiftId === s.id && d.userId === where.userId);
          return state.attempts
            .filter(
              (a) =>
                a.userId === where.userId &&
                a.channel === where.channel &&
                a.response === null &&
                a.shiftId === s.id &&
                biddable &&
                !declined
            )
            .map(() => ({ shift: { id: s.id, title: s.title } }));
        }
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
      async updateMany({
        where,
        data,
      }: {
        where: { shiftId: string; userId: string; channel: string };
        data: { response: string; respondedAt: Date };
      }) {
        const rows = state.attempts.filter(
          (a) => a.shiftId === where.shiftId && a.userId === where.userId && a.channel === where.channel
        );
        rows.forEach((a) => Object.assign(a, data));
        return { count: rows.length };
      },
    },

    shiftBid: {
      async findUnique({ where }: { where: { shiftId_workerId: { shiftId: string; workerId: string } } }) {
        const key = where.shiftId_workerId;
        const bid = state.bids.find((b) => b.shiftId === key.shiftId && b.workerId === key.workerId);
        return bid ? { id: `bid-${bid.workerId}`, ...bid } : null;
      },
      async deleteMany({ where }: { where: { id: string; status?: string } }) {
        const before = state.bids.length;
        state.bids = state.bids.filter(
          (b) => !(`bid-${b.workerId}` === where.id && (!where.status || b.status === where.status))
        );
        return { count: before - state.bids.length };
      },
      async upsert({
        where,
        create,
        update,
      }: {
        where: { shiftId_workerId: { shiftId: string; workerId: string } };
        create: FakeBid;
        update: Omit<FakeBid, "shiftId" | "workerId">;
      }) {
        const key = where.shiftId_workerId;
        const existing = state.bids.find(
          (b) => b.shiftId === key.shiftId && b.workerId === key.workerId
        );
        if (existing) {
          Object.assign(existing, update);
          return { id: `bid-${key.workerId}`, ...existing };
        }
        state.bids.push({ ...create });
        return { id: `bid-${key.workerId}`, ...create };
      },
    },

    shiftDecline: {
      async findMany({ where }: { where: { shiftId: string } }) {
        return state.declines.filter((d) => d.shiftId === where.shiftId);
      },
      async upsert({
        where,
        create,
        update,
      }: {
        where: { shiftId_userId: { shiftId: string; userId: string } };
        create: FakeDecline;
        update: { source: string };
      }) {
        const key = where.shiftId_userId;
        const existing = state.declines.find((d) => d.shiftId === key.shiftId && d.userId === key.userId);
        if (existing) {
          Object.assign(existing, update);
          return { id: `decline-${key.userId}`, ...existing };
        }
        state.declines.push({ ...create });
        return { id: `decline-${key.userId}`, ...create };
      },
      async deleteMany({ where }: { where: { shiftId: string; userId: string } }) {
        const before = state.declines.length;
        state.declines = state.declines.filter(
          (d) => !(d.shiftId === where.shiftId && d.userId === where.userId)
        );
        return { count: before - state.declines.length };
      },
    },

    processedWebhook: {
      async create({ data }: { data: { key: string } }) {
        if (processedWebhooks.has(data.key)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "fake",
            meta: { target: ["key"] },
          });
        }
        processedWebhooks.set(data.key, null);
        return { key: data.key };
      },
      async findUnique({ where }: { where: { key: string } }) {
        return processedWebhooks.has(where.key) ? { response: processedWebhooks.get(where.key) ?? null } : null;
      },
      async update({ where, data }: { where: { key: string }; data: { response: string } }) {
        processedWebhooks.set(where.key, data.response);
        return { key: where.key };
      },
      async delete({ where }: { where: { key: string } }) {
        processedWebhooks.delete(where.key);
        return { key: where.key };
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
      async createMany({ data }: { data: FakeState["notifications"] }) {
        state.notifications.push(...data);
        return { count: data.length };
      },
    },
  };
  return fakeDb;
}
