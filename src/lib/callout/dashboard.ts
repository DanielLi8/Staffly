/**
 * View model for the live fill dashboard. Server-only: it reads, joins, and
 * ranks, but holds no policy of its own - tiering, seniority, and the overtime
 * rule all come from the pure modules so the dashboard cannot drift from what
 * the cascade actually does.
 */
import type {
  BidStatus,
  BidDurationScope,
  Channel,
  DeliveryStatus,
  OutreachResponse,
  CampaignStatus,
} from "@prisma/client";
import { startOfWeek, endOfWeek } from "date-fns";
import { db } from "@/lib/db";
import { rankBySeniority } from "@/lib/seniority";
import { buildTierRoster, TIERS, type Tier } from "./tiers";
import { loadTierCandidates, tierEnteredAt, windowMinutesForTier } from "./campaign";
import {
  projectOvertime,
  DEFAULT_WEEK_STARTS_ON,
  type OvertimeProjection,
} from "./overtime";

export interface ChannelAttempt {
  channel: Channel;
  status: DeliveryStatus;
  response: OutreachResponse | null;
  respondedAt: Date | null;
}

export interface ReachedStaff {
  userId: string;
  name: string;
  /** The widest tier this person was reached in (they only ever belong to one). */
  tier: number;
  channels: ChannelAttempt[];
  /** Their bid on this shift, if any. */
  bidStatus: BidStatus | null;
  declined: boolean;
}

export interface DashboardBidder {
  bidId: string;
  workerId: string;
  name: string;
  position: string | null;
  department: string | null;
  note: string | null;
  durationScope: BidDurationScope;
  status: BidStatus;
  createdAt: Date;
  /** 1-based position in the seniority ranking of bidders. */
  seniorityPosition: number;
  overtime: OvertimeProjection;
}

export interface TierSummary {
  tier: Tier;
  /** How many people the tier targets in total. */
  candidateCount: number;
  /** How many of them outreach has actually recorded an attempt for. */
  reachedCount: number;
  enteredAt: Date | null;
  windowMinutes: number;
}

export interface FillDashboard {
  campaign: {
    status: CampaignStatus;
    currentTier: number;
    startedAt: Date;
    currentTierEnteredAt: Date | null;
    currentWindowMinutes: number;
    filledAt: Date | null;
    endedAt: Date | null;
    pastStartReminderAt: Date | null;
  } | null;
  shift: { id: string; status: string; startsAt: Date; endsAt: Date };
  /** Positions still to fill. This model books one worker per shift. */
  remainingGap: number;
  /** Minutes from campaign start to now (or to fill, once filled). */
  elapsedMinutes: number;
  /** Minutes from campaign start to fill; null while unfilled. */
  timeToFillMinutes: number | null;
  tiers: TierSummary[];
  reached: ReachedStaff[];
  bidders: DashboardBidder[];
}

const MINUTE_MS = 60_000;

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / MINUTE_MS));
}

/**
 * Assemble everything the scheduler's fill dashboard shows for one shift.
 * Returns null when the shift does not exist.
 */
export async function loadFillDashboard(
  shiftId: string,
  now: Date = new Date()
): Promise<FillDashboard | null> {
  const shift = await db.shift.findUnique({
    where: { id: shiftId },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      departmentId: true,
      campaign: true,
      bids: {
        include: {
          worker: {
            select: {
              id: true,
              name: true,
              position: true,
              department: true,
              seniorityRank: true,
              hireDate: true,
            },
          },
        },
      },
      outreachAttempts: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });
  if (!shift) return null;

  const campaign = shift.campaign;

  /* --- tier rosters, so the dashboard can show reach vs. remaining pool ---- */
  const candidates = await loadTierCandidates(shift);
  const roster = buildTierRoster(shift, candidates);

  const attemptsByUser = new Map<string, ChannelAttempt[]>();
  const tierByUser = new Map<string, number>();
  for (const attempt of shift.outreachAttempts) {
    const list = attemptsByUser.get(attempt.userId) ?? [];
    list.push({
      channel: attempt.channel,
      status: attempt.status,
      response: attempt.response,
      respondedAt: attempt.respondedAt,
    });
    attemptsByUser.set(attempt.userId, list);
    tierByUser.set(attempt.userId, Math.max(tierByUser.get(attempt.userId) ?? 0, attempt.tier));
  }

  const bidByWorker = new Map(shift.bids.map((b) => [b.workerId, b]));
  const nameByUser = new Map(shift.outreachAttempts.map((a) => [a.userId, a.user.name]));

  const reached: ReachedStaff[] = Array.from(attemptsByUser.entries())
    .map(([userId, channels]): ReachedStaff => ({
      userId,
      name: nameByUser.get(userId) ?? "Unknown",
      tier: tierByUser.get(userId) ?? 0,
      channels,
      bidStatus: bidByWorker.get(userId)?.status ?? null,
      declined: channels.some((c: ChannelAttempt) => c.response === "DECLINED"),
    }))
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));

  const reachedIdsByTier = new Map<number, Set<string>>();
  for (const attempt of shift.outreachAttempts) {
    const set = reachedIdsByTier.get(attempt.tier) ?? new Set<string>();
    set.add(attempt.userId);
    reachedIdsByTier.set(attempt.tier, set);
  }

  const tiers: TierSummary[] = TIERS.map((tier) => ({
    tier,
    candidateCount: roster[tier].length,
    reachedCount: reachedIdsByTier.get(tier)?.size ?? 0,
    enteredAt: campaign ? tierEnteredAt(campaign, tier) : null,
    windowMinutes: campaign ? windowMinutesForTier(campaign, tier) : 0,
  }));

  /* --- bidders: seniority order + overtime projection -------------------- */
  const bidders = await buildBidderRows(shift);

  const startedAt = campaign?.startedAt ?? null;
  const filledAt = campaign?.filledAt ?? null;

  return {
    campaign: campaign
      ? {
          status: campaign.status,
          currentTier: campaign.currentTier,
          startedAt: campaign.startedAt,
          currentTierEnteredAt: tierEnteredAt(campaign, campaign.currentTier),
          currentWindowMinutes: windowMinutesForTier(campaign, campaign.currentTier),
          filledAt: campaign.filledAt,
          endedAt: campaign.endedAt,
          pastStartReminderAt: campaign.pastStartReminderAt,
        }
      : null,
    shift: {
      id: shift.id,
      status: shift.status,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
    },
    remainingGap: shift.status === "OPEN" ? 1 : 0,
    elapsedMinutes: startedAt ? minutesBetween(startedAt, filledAt ?? now) : 0,
    timeToFillMinutes: startedAt && filledAt ? minutesBetween(startedAt, filledAt) : null,
    tiers,
    reached,
    bidders,
  };
}

/**
 * Rank the bidders by seniority (the awarding order) and flag whoever would go
 * into overtime if awarded. One query fetches every bidder's other ASSIGNED
 * shifts that start inside the target shift's work week.
 */
async function buildBidderRows(
  shift: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    bids: {
      id: string;
      workerId: string;
      note: string | null;
      durationScope: BidDurationScope;
      status: BidStatus;
      createdAt: Date;
      worker: {
        id: string;
        name: string;
        position: string | null;
        department: string | null;
        seniorityRank: number | null;
        hireDate: Date | null;
      };
    }[];
  }
): Promise<DashboardBidder[]> {
  if (shift.bids.length === 0) return [];

  const weekStart = startOfWeek(shift.startsAt, { weekStartsOn: DEFAULT_WEEK_STARTS_ON });
  const weekEnd = endOfWeek(shift.startsAt, { weekStartsOn: DEFAULT_WEEK_STARTS_ON });

  const assigned = await db.shift.findMany({
    where: {
      status: "ASSIGNED",
      assignedWorkerId: { in: shift.bids.map((b) => b.workerId) },
      startsAt: { gte: weekStart, lte: weekEnd },
      id: { not: shift.id },
    },
    select: { id: true, assignedWorkerId: true, startsAt: true, endsAt: true },
  });

  const assignedByWorker = new Map<string, { id: string; startsAt: Date; endsAt: Date }[]>();
  for (const s of assigned) {
    if (!s.assignedWorkerId) continue;
    const list = assignedByWorker.get(s.assignedWorkerId) ?? [];
    list.push({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt });
    assignedByWorker.set(s.assignedWorkerId, list);
  }

  // Seniority is the awarding order, so it is the order the dashboard shows.
  const ranked = rankBySeniority(shift.bids.map((b) => b.worker));
  const orderByWorker = new Map(ranked.map((w, i) => [w.id, i]));

  return [...shift.bids]
    .sort(
      (a, b) =>
        (orderByWorker.get(a.workerId) ?? 0) - (orderByWorker.get(b.workerId) ?? 0)
    )
    .map((bid, index) => ({
      bidId: bid.id,
      workerId: bid.workerId,
      name: bid.worker.name,
      position: bid.worker.position,
      department: bid.worker.department,
      note: bid.note,
      durationScope: bid.durationScope,
      status: bid.status,
      createdAt: bid.createdAt,
      seniorityPosition: index + 1,
      overtime: projectOvertime({
        targetShift: { id: shift.id, startsAt: shift.startsAt, endsAt: shift.endsAt },
        assignedShifts: assignedByWorker.get(bid.workerId) ?? [],
      }),
    }));
}

export type { OvertimeProjection };
