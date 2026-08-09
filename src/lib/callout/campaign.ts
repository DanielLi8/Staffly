/**
 * The callout campaign service: every authoritative write to a cascade.
 *
 * DESIGN RULE - Postgres is the source of truth, not Inngest. Every function
 * here re-reads the campaign row, decides against it, and writes the result. The
 * Inngest engine is a caller like any other; a scheduler pressing "Stop" writes
 * CANCELLED and the next engine step reads that and no-ops. Consequently the
 * whole cascade - posting, tier-1 outreach, advance, hold, stop - works with no
 * Inngest account. What Inngest adds is the timer, nothing more.
 *
 * The policy this file leans on is pure and tested elsewhere:
 *   - who is in which tier: ./tiers
 *   - what to do next, given a clock: ./decide
 */
import type { CampaignStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { dispatchOutreach, loadOutreachShift } from "@/lib/outreach";
import type { OutreachRecipient } from "@/lib/outreach/types";
import { notifySchedulerOfCallout } from "@/lib/notifications";
import { sendCalloutEvent } from "@/lib/inngest/client";
import { buildTierRoster, nextTier, MAX_TIER, type Tier, type TierCandidate } from "./tiers";
import { decideNextStep, type CampaignDecision, type CampaignState } from "./decide";

/** Statuses from which no further escalation may happen. */
const TERMINAL: CampaignStatus[] = ["CANCELLED", "FILLED", "EXHAUSTED"];

export interface CampaignActor {
  /** Who to attribute the activity entry to. */
  actorId: string;
  /** True when the engine acted rather than a person. */
  automatic?: boolean;
}

export type CampaignControlResult =
  | { ok: true; status: CampaignStatus; currentTier: number }
  | { ok: false; reason: "NO_CAMPAIGN" | "TERMINAL" | "SHIFT_CLOSED" };

/* ------------------------------------------------------------------ reading */

/** Window length configured for a given tier. */
export function windowMinutesForTier(
  campaign: { tier1WindowMinutes: number; tier2WindowMinutes: number; tier3WindowMinutes: number },
  tier: number
): number {
  if (tier <= 1) return campaign.tier1WindowMinutes;
  if (tier === 2) return campaign.tier2WindowMinutes;
  return campaign.tier3WindowMinutes;
}

/** When the given tier was entered. */
export function tierEnteredAt(
  campaign: { tier1EnteredAt: Date | null; tier2EnteredAt: Date | null; tier3EnteredAt: Date | null },
  tier: number
): Date | null {
  if (tier <= 1) return campaign.tier1EnteredAt;
  if (tier === 2) return campaign.tier2EnteredAt;
  return campaign.tier3EnteredAt;
}

const TIER_ENTERED_FIELD: Record<Tier, "tier1EnteredAt" | "tier2EnteredAt" | "tier3EnteredAt"> = {
  1: "tier1EnteredAt",
  2: "tier2EnteredAt",
  3: "tier3EnteredAt",
};

/**
 * Everything one engine step needs, in one read: the campaign row plus the shift
 * state that can override it.
 */
export async function loadCampaignSnapshot(shiftId: string) {
  const campaign = await db.calloutCampaign.findUnique({
    where: { shiftId },
    include: {
      shift: { select: { id: true, status: true, startsAt: true, createdById: true, title: true } },
    },
  });
  return campaign;
}

/** Project a campaign row into the pure decision input. */
export function toCampaignState(campaign: {
  status: CampaignStatus;
  currentTier: number;
  tier1EnteredAt: Date | null;
  tier2EnteredAt: Date | null;
  tier3EnteredAt: Date | null;
  tier1WindowMinutes: number;
  tier2WindowMinutes: number;
  tier3WindowMinutes: number;
  pastStartReminderAt: Date | null;
}): CampaignState {
  return {
    status: campaign.status,
    currentTier: campaign.currentTier,
    tierEnteredAt: tierEnteredAt(campaign, campaign.currentTier),
    windowMinutes: windowMinutesForTier(campaign, campaign.currentTier),
    pastStartReminderAt: campaign.pastStartReminderAt,
  };
}

/* ------------------------------------------------------- candidate targeting */

/**
 * Load the callout candidate pool for a shift: every STAFF user, with their
 * department memberships and only the availability windows that could touch the
 * shift. Tier assignment itself is left to the pure targeting module.
 */
export async function loadTierCandidates(shift: {
  startsAt: Date;
  endsAt: Date;
}): Promise<(TierCandidate & OutreachRecipient)[]> {
  const staff = await db.user.findMany({
    where: { role: "STAFF" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      phoneVerifiedAt: true,
      seniorityRank: true,
      hireDate: true,
      departmentMemberships: { select: { departmentId: true } },
      availabilities: {
        where: { startsAt: { lt: shift.endsAt }, endsAt: { gt: shift.startsAt } },
        select: { startsAt: true, endsAt: true, status: true },
      },
    },
  });

  return staff.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    phoneVerifiedAt: u.phoneVerifiedAt,
    seniorityRank: u.seniorityRank,
    hireDate: u.hireDate,
    departmentIds: u.departmentMemberships.map((m) => m.departmentId),
    availabilities: u.availabilities,
  }));
}

/**
 * Fire one tier's outreach. Returns how many people the tier targeted.
 *
 * The dispatcher is idempotent per (shift, tier, user, channel), so calling this
 * twice for the same tier - an engine retry, or a scheduler re-advancing - does
 * not re-contact anyone.
 */
export async function runTierOutreach(shiftId: string, tier: Tier): Promise<number> {
  const shift = await db.shift.findUnique({
    where: { id: shiftId },
    select: { id: true, departmentId: true, startsAt: true, endsAt: true },
  });
  if (!shift) return 0;

  const outreachShift = await loadOutreachShift(shiftId);
  if (!outreachShift) return 0;

  const candidates = await loadTierCandidates(shift);
  const roster = buildTierRoster(shift, candidates);
  const recipients = roster[tier];

  await dispatchOutreach(outreachShift, recipients, { tier });
  return recipients.length;
}

/* ------------------------------------------------------------------ writing */

async function logCalloutActivity(
  shiftId: string,
  actorId: string,
  action: string,
  details: string
): Promise<void> {
  await db.shiftActivity.create({ data: { shiftId, actorId, action, details } });
}

/**
 * Start (or re-attach to) the cascade for a freshly posted shift.
 *
 * Tier-1 outreach fires SYNCHRONOUSLY here, before any Inngest involvement, so
 * the credential-free demo reaches real people the moment a shift is posted.
 */
export async function startCalloutCampaign(shiftId: string): Promise<{ campaignId: string } | null> {
  const shift = await db.shift.findUnique({
    where: { id: shiftId },
    select: { id: true, createdById: true },
  });
  if (!shift) return null;

  const now = new Date();
  const campaign = await db.calloutCampaign.upsert({
    where: { shiftId },
    create: { shiftId, currentTier: 1, status: "RUNNING", startedAt: now, tier1EnteredAt: now },
    update: {},
  });

  const targeted = await runTierOutreach(shiftId, 1);
  await logCalloutActivity(
    shiftId,
    shift.createdById,
    "CALLOUT_STARTED",
    `Tier 1 callout opened to ${targeted} available department staff.`
  );

  // An empty tier has nobody to wait for, so widen immediately instead of
  // burning a whole window on silence.
  if (targeted === 0) {
    await advanceCampaignTier(shiftId, { actorId: shift.createdById, automatic: true });
  }

  // Best effort: hands the timer to Inngest when it is configured. Everything
  // above already happened regardless.
  await sendCalloutEvent("callout/started", { shiftId, campaignId: campaign.id });

  return { campaignId: campaign.id };
}

/**
 * Widen the cascade by one tier and fire that tier's outreach. Refuses on a
 * terminal campaign or a shift that is no longer open - the DB state is re-read
 * here, so a stale UI cannot resurrect a stopped campaign.
 *
 * A tier that targets nobody is skipped straight through rather than sat on for
 * its window; if every remaining tier is empty the campaign ends EXHAUSTED.
 */
export async function advanceCampaignTier(
  shiftId: string,
  actor: CampaignActor
): Promise<CampaignControlResult> {
  const campaign = await loadCampaignSnapshot(shiftId);
  if (!campaign) return { ok: false, reason: "NO_CAMPAIGN" };
  if (TERMINAL.includes(campaign.status)) return { ok: false, reason: "TERMINAL" };
  if (campaign.shift.status !== "OPEN") return { ok: false, reason: "SHIFT_CLOSED" };

  const target = nextTier(campaign.currentTier);
  if (target === null) {
    // Already at the widest tier: there is nobody left to call.
    return exhaustCampaign(shiftId, actor);
  }

  const now = new Date();
  const updated = await db.calloutCampaign.update({
    where: { shiftId },
    data: {
      currentTier: target,
      // Advancing also lifts a hold - the scheduler is explicitly acting.
      status: "RUNNING",
      [TIER_ENTERED_FIELD[target]]: now,
    },
  });

  const targeted = await runTierOutreach(shiftId, target);
  await logCalloutActivity(
    shiftId,
    actor.actorId,
    "CALLOUT_ESCALATED",
    targeted === 0
      ? `Tier ${target} had no candidates; widening further.`
      : `${actor.automatic ? "Auto-escalated" : "Escalated"} to tier ${target}; ${targeted} staff contacted.`
  );

  if (targeted === 0) {
    // Nothing to wait for. Recursion is bounded by the tier count.
    return advanceCampaignTier(shiftId, actor);
  }

  await notifySchedulerOfCallout({
    schedulerId: campaign.shift.createdById,
    type: "CALLOUT_ESCALATED",
    title: "Callout escalated",
    message: `${campaign.shift.title} widened to tier ${target} (${targeted} staff contacted).`,
    shiftId,
  });
  await sendCalloutEvent("callout/control", { shiftId, reason: `advanced to tier ${target}` });

  return { ok: true, status: updated.status, currentTier: updated.currentTier };
}

/** Put the cascade on hold. The engine keeps waiting but will not widen. */
export async function holdCampaign(
  shiftId: string,
  actor: CampaignActor
): Promise<CampaignControlResult> {
  return setCampaignStatus(shiftId, "PAUSED", actor, {
    action: "CALLOUT_HELD",
    details: "Cascade put on hold; no further tiers will open automatically.",
  });
}

/** Take the cascade off hold, restarting the current tier's window. */
export async function resumeCampaign(
  shiftId: string,
  actor: CampaignActor
): Promise<CampaignControlResult> {
  const campaign = await loadCampaignSnapshot(shiftId);
  if (!campaign) return { ok: false, reason: "NO_CAMPAIGN" };
  if (TERMINAL.includes(campaign.status)) return { ok: false, reason: "TERMINAL" };
  if (campaign.shift.status !== "OPEN") return { ok: false, reason: "SHIFT_CLOSED" };

  const tier = (Math.min(Math.max(campaign.currentTier, 1), MAX_TIER) as Tier);
  const updated = await db.calloutCampaign.update({
    where: { shiftId },
    data: { status: "RUNNING", [TIER_ENTERED_FIELD[tier]]: new Date() },
  });
  await logCalloutActivity(
    shiftId,
    actor.actorId,
    "CALLOUT_RESUMED",
    `Cascade resumed on tier ${tier}.`
  );
  await sendCalloutEvent("callout/control", { shiftId, reason: "resumed" });
  return { ok: true, status: updated.status, currentTier: updated.currentTier };
}

/** Stop the cascade for good. This is the authoritative kill switch. */
export async function stopCampaign(
  shiftId: string,
  actor: CampaignActor
): Promise<CampaignControlResult> {
  return setCampaignStatus(shiftId, "CANCELLED", actor, {
    action: "CALLOUT_STOPPED",
    details: "Cascade stopped by scheduler; no further outreach will be sent.",
    endsCampaign: true,
  });
}

/** Close the campaign because the shift was filled. Called from assignWorker. */
export async function markCampaignFilled(
  shiftId: string,
  actor: CampaignActor
): Promise<CampaignControlResult> {
  return setCampaignStatus(shiftId, "FILLED", actor, {
    action: "CALLOUT_FILLED",
    details: "Shift filled; cascade closed.",
    endsCampaign: true,
    allowWhenShiftClosed: true,
  });
}

/** All tiers have been through their window with no fill. */
export async function exhaustCampaign(
  shiftId: string,
  actor: CampaignActor
): Promise<CampaignControlResult> {
  const result = await setCampaignStatus(shiftId, "EXHAUSTED", actor, {
    action: "CALLOUT_EXHAUSTED",
    details: `All ${MAX_TIER} tiers contacted with no fill.`,
    endsCampaign: true,
  });
  if (result.ok) {
    const campaign = await loadCampaignSnapshot(shiftId);
    if (campaign) {
      await notifySchedulerOfCallout({
        schedulerId: campaign.shift.createdById,
        type: "CALLOUT_REMINDER",
        title: "Callout exhausted",
        message: `${campaign.shift.title} reached every tier with no fill. The shift is still open.`,
        shiftId,
      });
    }
  }
  return result;
}

/**
 * The shift start has passed and it is still unfilled. We raise a scheduler
 * reminder and record that we did - the callout is NEVER auto-expired, because
 * a hospital still needs the shift covered after it has started.
 */
export async function raisePastStartReminder(shiftId: string): Promise<boolean> {
  const campaign = await loadCampaignSnapshot(shiftId);
  if (!campaign || campaign.pastStartReminderAt) return false;

  await db.calloutCampaign.update({
    where: { shiftId },
    data: { pastStartReminderAt: new Date() },
  });
  await notifySchedulerOfCallout({
    schedulerId: campaign.shift.createdById,
    type: "CALLOUT_REMINDER",
    title: "Shift started unfilled",
    message: `${campaign.shift.title} has passed its start time and is still unfilled. It remains open for bidding.`,
    shiftId,
  });
  await logCalloutActivity(
    shiftId,
    campaign.shift.createdById,
    "CALLOUT_PAST_START",
    "Shift start passed while unfilled; scheduler reminded (callout left open)."
  );
  return true;
}

async function setCampaignStatus(
  shiftId: string,
  status: CampaignStatus,
  actor: CampaignActor,
  opts: {
    action: string;
    details: string;
    endsCampaign?: boolean;
    allowWhenShiftClosed?: boolean;
  }
): Promise<CampaignControlResult> {
  const campaign = await loadCampaignSnapshot(shiftId);
  if (!campaign) return { ok: false, reason: "NO_CAMPAIGN" };
  if (TERMINAL.includes(campaign.status)) return { ok: false, reason: "TERMINAL" };
  if (!opts.allowWhenShiftClosed && campaign.shift.status !== "OPEN") {
    return { ok: false, reason: "SHIFT_CLOSED" };
  }

  const now = new Date();
  const updated = await db.calloutCampaign.update({
    where: { shiftId },
    data: {
      status,
      ...(opts.endsCampaign ? { endedAt: now } : {}),
      ...(status === "FILLED" ? { filledAt: now } : {}),
    },
  });
  await logCalloutActivity(shiftId, actor.actorId, opts.action, opts.details);
  await sendCalloutEvent("callout/control", { shiftId, reason: status });

  return { ok: true, status: updated.status, currentTier: updated.currentTier };
}

/* ------------------------------------------------------------------- engine */

/**
 * Apply one decision. Shared by the Inngest engine and, in tests, by any driver
 * that wants to step a campaign forward without a scheduler in the loop.
 */
export async function applyDecision(
  shiftId: string,
  decision: CampaignDecision,
  actor: CampaignActor
): Promise<void> {
  if (decision.remindPastStart) {
    await raisePastStartReminder(shiftId);
  }
  switch (decision.action) {
    case "ADVANCE":
      await advanceCampaignTier(shiftId, actor);
      break;
    case "EXHAUST":
      await exhaustCampaign(shiftId, actor);
      break;
    case "FILL":
      await markCampaignFilled(shiftId, actor);
      break;
    case "WAIT":
    case "HALT":
      break;
  }
}

/**
 * Read state, decide, apply - the single step the Inngest engine loops over.
 * Exposed here (rather than inside the Inngest function) so the cascade can be
 * driven and tested with no Inngest at all.
 */
export async function stepCampaign(
  shiftId: string,
  now: Date = new Date()
): Promise<CampaignDecision | null> {
  const campaign = await loadCampaignSnapshot(shiftId);
  if (!campaign) return null;

  const decision = decideNextStep({
    now,
    campaign: toCampaignState(campaign),
    shift: { status: campaign.shift.status, startsAt: campaign.shift.startsAt },
  });

  await applyDecision(shiftId, decision, {
    actorId: campaign.shift.createdById,
    automatic: true,
  });
  return decision;
}
