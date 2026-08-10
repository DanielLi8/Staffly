/**
 * The callout campaign service: every authoritative write to a cascade.
 *
 * DESIGN RULE - Postgres is the source of truth, not Inngest. Every function
 * here re-reads the campaign row, decides against it, and writes the result. The
 * Inngest engine is a caller like any other; a scheduler pressing "Stop" writes
 * CANCELLED and the next engine step reads that and no-ops. Consequently the
 * whole cascade - posting, tier-1 outreach, advance, hold, stop - works with no
 * Inngest account. What Inngest adds is the timers, nothing more: the posting
 * delay before tier 1, and the tier windows after it.
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
import { isInngestConfigured, sendCalloutEvent } from "@/lib/inngest/client";
import { buildTierRoster, nextTier, MAX_TIER, type Tier, type TierCandidate } from "./tiers";
import { decideNextStep, type CampaignDecision, type CampaignState } from "./decide";

/** Statuses from which no further escalation may happen. */
const TERMINAL: CampaignStatus[] = ["CANCELLED", "FILLED", "EXHAUSTED"];

/**
 * How long a freshly posted shift sits before ANY outreach leaves the building.
 *
 * Deliberate, not incidental: an SMS and an automated phone call are things you
 * cannot take back, and a shift is most likely to be corrected or pulled in the
 * seconds right after it is posted. The delay buys the scheduler that window.
 *
 * It is enforced by a DURABLE timer (Inngest), never an in-process one, so a
 * serverless invocation ending - or the box restarting - cannot lose it. See
 * `startCalloutCampaign` for what happens with no Inngest account.
 */
export const TIER1_DISPATCH_DELAY_SECONDS = 60;

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
  tier1DispatchAt: Date | null;
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
    dispatchDueAt: campaign.tier1DispatchAt,
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
 * Tier-1 outreach is NOT sent here. The campaign opens with `tier1DispatchAt`
 * set one delay into the future and nobody contacted; Inngest's durable timer
 * then calls `dispatchOpeningTier` when it falls due. Deferring in the database
 * rather than in the process is the whole point - the pending send survives a
 * restart, and the shift being pulled inside the window cancels it for good.
 *
 * WITHOUT an Inngest account there is no durable timer to hand the wait to, so
 * we fall back to today's behaviour and dispatch immediately. That keeps the
 * credential-free demo working end to end (see tests/callout/no-inngest.test.ts);
 * what it costs is the delay itself, not the outreach. We will not fake it with
 * an in-process timer, which a serverless invocation would simply drop.
 */
export async function startCalloutCampaign(shiftId: string): Promise<{ campaignId: string } | null> {
  const shift = await db.shift.findUnique({
    where: { id: shiftId },
    select: { id: true, createdById: true },
  });
  if (!shift) return null;

  const now = new Date();
  const dispatchAt = new Date(now.getTime() + TIER1_DISPATCH_DELAY_SECONDS * 1000);
  const campaign = await db.calloutCampaign.upsert({
    where: { shiftId },
    create: {
      shiftId,
      currentTier: 1,
      status: "RUNNING",
      startedAt: now,
      tier1DispatchAt: dispatchAt,
    },
    update: {},
  });

  await logCalloutActivity(
    shiftId,
    shift.createdById,
    "CALLOUT_STARTED",
    `Callout opened. Tier 1 outreach is held for ${TIER1_DISPATCH_DELAY_SECONDS}s; nobody has been contacted yet.`
  );

  // Best effort: hands the timer to Inngest when it is configured.
  await sendCalloutEvent("callout/started", { shiftId, campaignId: campaign.id });

  if (!isInngestConfigured()) {
    await dispatchOpeningTier(shiftId, { actorId: shift.createdById, automatic: true });
  }

  return { campaignId: campaign.id };
}

/**
 * Send the opening tier's outreach, once its delay has elapsed.
 *
 * This is where the deferral becomes a real guarantee rather than a pause: the
 * campaign row is RE-READ here, so a shift stopped, filled, or cancelled inside
 * the delay window ends the callout with nobody contacted at all. Clearing
 * `tier1DispatchAt` in the same breath makes it fire exactly once, however many
 * times an engine step is retried.
 */
export async function dispatchOpeningTier(
  shiftId: string,
  actor: CampaignActor
): Promise<CampaignControlResult> {
  const campaign = await loadCampaignSnapshot(shiftId);
  if (!campaign) return { ok: false, reason: "NO_CAMPAIGN" };
  if (TERMINAL.includes(campaign.status)) return { ok: false, reason: "TERMINAL" };
  if (campaign.shift.status !== "OPEN") return { ok: false, reason: "SHIFT_CLOSED" };
  // Already sent, or held by a scheduler. Not an error - the engine retries.
  if (!campaign.tier1DispatchAt || campaign.status !== "RUNNING") {
    return { ok: true, status: campaign.status, currentTier: campaign.currentTier };
  }

  const now = new Date();
  const updated = await db.calloutCampaign.update({
    where: { shiftId },
    data: { tier1DispatchAt: null, tier1EnteredAt: now },
  });

  const targeted = await runTierOutreach(shiftId, 1);
  await logCalloutActivity(
    shiftId,
    actor.actorId,
    "CALLOUT_TIER1_SENT",
    `Tier 1 callout opened to ${targeted} available department staff.`
  );

  // An empty tier has nobody to wait for, so widen immediately instead of
  // burning a whole window on silence.
  if (targeted === 0) {
    return advanceCampaignTier(shiftId, actor);
  }

  return { ok: true, status: updated.status, currentTier: updated.currentTier };
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

  // Widening while the opening outreach is still held back: whoever is asking
  // wants MORE reach, so tier 1 goes out now rather than being skipped entirely.
  // Done inline (not via dispatchOpeningTier) so an empty tier 1 cannot recurse
  // back into this function and double-advance.
  if (campaign.tier1DispatchAt) {
    await db.calloutCampaign.update({
      where: { shiftId },
      data: { tier1DispatchAt: null, tier1EnteredAt: now },
    });
    await runTierOutreach(shiftId, 1);
  }

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

  const now = new Date();
  const tier = (Math.min(Math.max(campaign.currentTier, 1), MAX_TIER) as Tier);
  // Held before anyone was contacted: what restarts is the posting delay, not a
  // tier window. Stamping a tier entry here would strand the pending dispatch.
  const pending = campaign.tier1DispatchAt !== null;
  const updated = await db.calloutCampaign.update({
    where: { shiftId },
    data: pending
      ? {
          status: "RUNNING",
          tier1DispatchAt: new Date(now.getTime() + TIER1_DISPATCH_DELAY_SECONDS * 1000),
        }
      : { status: "RUNNING", [TIER_ENTERED_FIELD[tier]]: now },
  });
  await logCalloutActivity(
    shiftId,
    actor.actorId,
    "CALLOUT_RESUMED",
    pending
      ? `Cascade resumed; tier 1 outreach re-held for ${TIER1_DISPATCH_DELAY_SECONDS}s.`
      : `Cascade resumed on tier ${tier}.`
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
    case "DISPATCH":
      await dispatchOpeningTier(shiftId, actor);
      break;
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
