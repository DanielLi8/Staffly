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
import type { CampaignStatus, Prisma } from "@prisma/client";
import { guardedTransaction, Rollback } from "@/lib/db-guard";
import { db } from "@/lib/db";
import { dispatchOutreach, loadOutreachShift } from "@/lib/outreach";
import type { OutreachRecipient, OutreachShift } from "@/lib/outreach/types";
import { notifySchedulerOfCallout } from "@/lib/notifications";
import { isInngestConfigured, sendCalloutEvent } from "@/lib/inngest/client";
import { buildTierRoster, nextTier, MAX_TIER, type Tier, type TierCandidate } from "./tiers";
import {
  decideNextStep,
  isCampaignTerminal,
  type CampaignDecision,
  type CampaignState,
} from "./decide";
import { positionMatchesRole } from "@/lib/shifts/role-match";

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
  /**
   * CHANGED: the campaign moved since the caller looked (another admin or the
   * engine advanced, held or resumed it first), so this transition no longer
   * applies. Every transition below is a conditional write on the state it
   * was decided from; this is what the loser of a race gets.
   */
  | { ok: false; reason: "NO_CAMPAIGN" | "TERMINAL" | "SHIFT_CLOSED" | "CHANGED" };

/** Statuses outreach is still live in. */
const LIVE: CampaignStatus[] = ["RUNNING", "PAUSED"];

/**
 * Which statuses an actor may move a campaign out of. The engine never acts on
 * a held campaign - a hold landing between its read and its write must win -
 * while a scheduler's explicit advance/stop also applies to a held one.
 */
function movableFrom(actor: CampaignActor): CampaignStatus[] {
  return actor.automatic ? ["RUNNING"] : LIVE;
}

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
 * Load the callout candidate pool for a shift: every STAFF user whose
 * clinical position qualifies them for the shift's required role (see
 * `positionMatchesRole` - a Lead RN/Team Lead tag never affects this, only
 * `position` does), with their department memberships and only the
 * availability windows that could touch the shift. Tier assignment itself is
 * left to the pure targeting module.
 */
export async function loadTierCandidates(shift: {
  startsAt: Date;
  endsAt: Date;
  roleNeeded: string;
}): Promise<(TierCandidate & OutreachRecipient)[]> {
  const staff = await db.user.findMany({
    where: { role: "STAFF" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      phoneVerifiedAt: true,
      position: true,
      seniorityRank: true,
      hireDate: true,
      departmentMemberships: { select: { departmentId: true } },
      availabilities: {
        where: { startsAt: { lt: shift.endsAt }, endsAt: { gt: shift.startsAt } },
        select: { startsAt: true, endsAt: true, status: true },
      },
    },
  });

  return staff
    .filter((u) => positionMatchesRole(u.position, shift.roleNeeded))
    .map((u) => ({
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
 * not re-contact anyone. Anyone who declined the shift is left out.
 */
export async function runTierOutreach(shiftId: string, tier: Tier): Promise<number> {
  const tierRoster = await loadTierRecipients(shiftId, tier);
  if (!tierRoster) return 0;
  await sendTier(tierRoster, tier);
  return tierRoster.recipients.length;
}

interface TierRecipients {
  outreachShift: OutreachShift;
  recipients: OutreachRecipient[];
}

/** Who a tier targets, without contacting anyone yet. */
async function loadTierRecipients(shiftId: string, tier: Tier): Promise<TierRecipients | null> {
  const shift = await db.shift.findUnique({
    where: { id: shiftId },
    select: { id: true, departmentId: true, startsAt: true, endsAt: true, roleNeeded: true },
  });
  if (!shift) return null;

  const outreachShift = await loadOutreachShift(shiftId);
  if (!outreachShift) return null;

  const candidates = await loadTierCandidates(shift);
  const roster = buildTierRoster(shift, candidates);
  // Whoever already said no (any channel - see recordDecline) is never
  // contacted about this shift again.
  const declined = new Set(
    (
      await db.shiftDecline.findMany({ where: { shiftId }, select: { userId: true } })
    ).map((d) => d.userId)
  );
  return { outreachShift, recipients: roster[tier].filter((r) => !declined.has(r.id)) };
}

/**
 * Contact a tier. Sends are claimed one by one against the live campaign (see
 * dispatchOutreach), so a Stop landing mid-tier halts the rest of the tier.
 */
async function sendTier(tierRoster: TierRecipients, tier: Tier): Promise<void> {
  await dispatchOutreach(tierRoster.outreachShift, tierRoster.recipients, { tier });
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
 * Apply one campaign transition: a conditional write on the state it was
 * decided from, plus its activity row, in ONE transaction. False when the
 * campaign had already moved (another admin or the engine won the race), in
 * which case nothing was written. Committing the activity row with the
 * transition is what lets a loser be told, truthfully, who beat them.
 */
async function transition(
  shiftId: string,
  where: Prisma.CalloutCampaignWhereInput,
  data: Prisma.CalloutCampaignUpdateManyMutationInput,
  activity: { actorId: string; action: string; details: string }
): Promise<boolean> {
  const outcome = await guardedTransaction<void, "LOST">(async (tx) => {
    const moved = await tx.calloutCampaign.updateMany({ where: { ...where, shiftId }, data });
    if (moved.count !== 1) throw new Rollback("LOST");
    await tx.shiftActivity.create({ data: { shiftId, ...activity } });
  });
  return outcome.ok;
}

/** Why a conditional campaign write matched nothing, read after the fact. */
async function lostRace(shiftId: string): Promise<CampaignControlResult> {
  const campaign = await loadCampaignSnapshot(shiftId);
  if (!campaign) return { ok: false, reason: "NO_CAMPAIGN" };
  if (isCampaignTerminal(campaign.status)) return { ok: false, reason: "TERMINAL" };
  if (campaign.shift.status !== "OPEN") return { ok: false, reason: "SHIFT_CLOSED" };
  return { ok: false, reason: "CHANGED" };
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
 * `tier1DispatchAt` is a conditional claim (only while it is still set and the
 * campaign RUNNING), so it fires exactly once however many times an engine step
 * is retried or races a scheduler's advance.
 */
export async function dispatchOpeningTier(
  shiftId: string,
  actor: CampaignActor
): Promise<CampaignControlResult> {
  const campaign = await loadCampaignSnapshot(shiftId);
  if (!campaign) return { ok: false, reason: "NO_CAMPAIGN" };
  if (isCampaignTerminal(campaign.status)) return { ok: false, reason: "TERMINAL" };
  if (campaign.shift.status !== "OPEN") return { ok: false, reason: "SHIFT_CLOSED" };
  // Already sent, or held by a scheduler. Not an error - the engine retries.
  if (!campaign.tier1DispatchAt || campaign.status !== "RUNNING") {
    return { ok: true, status: campaign.status, currentTier: campaign.currentTier };
  }

  const tier1 = await loadTierRecipients(shiftId, 1);
  const targeted = tier1?.recipients.length ?? 0;
  const claimed = await transition(
    shiftId,
    { status: "RUNNING", tier1DispatchAt: { not: null } },
    { tier1DispatchAt: null, tier1EnteredAt: new Date() },
    {
      actorId: actor.actorId,
      action: "CALLOUT_TIER1_SENT",
      details: `Tier 1 callout opened to ${targeted} available department staff.`,
    }
  );
  if (!claimed) {
    // Someone else sent it, or it was held/stopped since the read above.
    const current = await lostRace(shiftId);
    if (current.ok || current.reason !== "CHANGED") return current;
    const fresh = await loadCampaignSnapshot(shiftId);
    return { ok: true, status: fresh!.status, currentTier: fresh!.currentTier };
  }

  if (tier1) await sendTier(tier1, 1);

  // An empty tier has nobody to wait for, so widen immediately instead of
  // burning a whole window on silence.
  if (targeted === 0) {
    return advanceCampaignTier(shiftId, actor, { fromTier: 1 });
  }

  return { ok: true, status: "RUNNING", currentTier: 1 };
}

/**
 * Widen the cascade by one tier and fire that tier's outreach. Refuses on a
 * terminal campaign or a shift that is no longer open - the DB state is re-read
 * here, so a stale UI cannot resurrect a stopped campaign.
 *
 * Race-safe: the tier only moves FROM `fromTier` (the tier the scheduler saw,
 * or the engine decided on) and only while outreach is live, in one
 * conditional write. So a concurrent Stop always wins (once it commits, this
 * matches nothing; if this commits first, Stop then ends it and the claim
 * check in dispatchOutreach halts the new tier's sends), and two Advances from
 * the same tier move it once, not twice.
 *
 * A tier that targets nobody is skipped straight through rather than sat on for
 * its window; if every remaining tier is empty the campaign ends EXHAUSTED.
 */
export async function advanceCampaignTier(
  shiftId: string,
  actor: CampaignActor,
  opts: { fromTier?: number } = {}
): Promise<CampaignControlResult> {
  const campaign = await loadCampaignSnapshot(shiftId);
  if (!campaign) return { ok: false, reason: "NO_CAMPAIGN" };
  if (isCampaignTerminal(campaign.status)) return { ok: false, reason: "TERMINAL" };
  if (campaign.shift.status !== "OPEN") return { ok: false, reason: "SHIFT_CLOSED" };

  const fromTier = opts.fromTier ?? campaign.currentTier;
  const from = movableFrom(actor);
  if (campaign.currentTier !== fromTier || !from.includes(campaign.status)) {
    return { ok: false, reason: "CHANGED" };
  }

  const target = nextTier(fromTier);
  if (target === null) {
    // Already at the widest tier: there is nobody left to call.
    return exhaustCampaign(shiftId, actor, { fromTier });
  }

  const now = new Date();
  // Widening while the opening outreach is still held back: whoever is asking
  // wants MORE reach, so tier 1 goes out now rather than being skipped entirely.
  const tier1Pending = campaign.tier1DispatchAt !== null;
  const widened = await loadTierRecipients(shiftId, target);
  const targeted = widened?.recipients.length ?? 0;
  const moved = await transition(
    shiftId,
    { currentTier: fromTier, status: { in: from } },
    {
      currentTier: target,
      // Advancing also lifts a hold - the scheduler is explicitly acting.
      status: "RUNNING",
      [TIER_ENTERED_FIELD[target]]: now,
      ...(tier1Pending ? { tier1DispatchAt: null, tier1EnteredAt: now } : {}),
    },
    {
      actorId: actor.actorId,
      action: "CALLOUT_ESCALATED",
      details:
        targeted === 0
          ? `Tier ${target} had no candidates; widening further.`
          : `${actor.automatic ? "Auto-escalated" : "Escalated"} to tier ${target}; ${targeted} staff contacted.`,
    }
  );
  if (!moved) return lostRace(shiftId);

  // Done inline (not via dispatchOpeningTier) so an empty tier 1 cannot recurse
  // back into this function and double-advance. Claims make it a no-op if the
  // engine dispatched tier 1 at the same moment.
  if (tier1Pending) await runTierOutreach(shiftId, 1);
  if (widened) await sendTier(widened, target);

  if (targeted === 0) {
    // Nothing to wait for. Recursion is bounded by the tier count. If a Stop
    // landed meanwhile the next step refuses, but THIS advance did happen.
    const further = await advanceCampaignTier(shiftId, actor, { fromTier: target });
    if (further.ok) return further;
    const fresh = await loadCampaignSnapshot(shiftId);
    return { ok: true, status: fresh?.status ?? "RUNNING", currentTier: fresh?.currentTier ?? target };
  }

  await notifySchedulerOfCallout({
    schedulerId: campaign.shift.createdById,
    type: "CALLOUT_ESCALATED",
    title: "Callout escalated",
    message: `${campaign.shift.title} widened to tier ${target} (${targeted} staff contacted).`,
    shiftId,
  });
  await sendCalloutEvent("callout/control", { shiftId, reason: `advanced to tier ${target}` });

  const fresh = await loadCampaignSnapshot(shiftId);
  return { ok: true, status: fresh?.status ?? "RUNNING", currentTier: fresh?.currentTier ?? target };
}

/** Put the cascade on hold. The engine keeps waiting but will not widen. */
export async function holdCampaign(
  shiftId: string,
  actor: CampaignActor
): Promise<CampaignControlResult> {
  return setCampaignStatus(shiftId, "PAUSED", actor, {
    from: ["RUNNING"],
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
  if (isCampaignTerminal(campaign.status)) return { ok: false, reason: "TERMINAL" };
  if (campaign.shift.status !== "OPEN") return { ok: false, reason: "SHIFT_CLOSED" };

  const now = new Date();
  const tier = (Math.min(Math.max(campaign.currentTier, 1), MAX_TIER) as Tier);
  // Held before anyone was contacted: what restarts is the posting delay, not a
  // tier window. Stamping a tier entry here would strand the pending dispatch.
  const pending = campaign.tier1DispatchAt !== null;
  const resumed = await transition(
    shiftId,
    { status: "PAUSED" },
    pending
      ? {
          status: "RUNNING",
          tier1DispatchAt: new Date(now.getTime() + TIER1_DISPATCH_DELAY_SECONDS * 1000),
        }
      : { status: "RUNNING", [TIER_ENTERED_FIELD[tier]]: now },
    {
      actorId: actor.actorId,
      action: "CALLOUT_RESUMED",
      details: pending
        ? `Cascade resumed; tier 1 outreach re-held for ${TIER1_DISPATCH_DELAY_SECONDS}s.`
        : `Cascade resumed on tier ${tier}.`,
    }
  );
  if (!resumed) return lostRace(shiftId);
  await sendCalloutEvent("callout/control", { shiftId, reason: "resumed" });
  return { ok: true, status: "RUNNING", currentTier: campaign.currentTier };
}

/**
 * Stop outreach for good: no more texts, calls, or tiers. This is the
 * authoritative kill switch for OUTREACH only - the shift stays OPEN and keeps
 * taking bids (in the app, and by reply to earlier texts and calls) until it
 * is awarded or cancelled. See `bidAcceptance`.
 *
 * Stop always wins a race: it applies from any live status and any tier, so a
 * concurrent advance/hold/resume can never undo it (they all match only live
 * rows), and every send after it is refused at claim time.
 */
export async function stopCampaign(
  shiftId: string,
  actor: CampaignActor
): Promise<CampaignControlResult> {
  return setCampaignStatus(shiftId, "CANCELLED", actor, {
    from: LIVE,
    action: "CALLOUT_STOPPED",
    details: "Outreach stopped by scheduler; no further texts or calls will be sent. Bidding stays open.",
    endsCampaign: true,
  });
}

/** Campaign statuses an award can close out. Everything except FILLED itself. */
const FILLABLE: CampaignStatus[] = ["RUNNING", "PAUSED", "CANCELLED", "EXHAUSTED"];

/**
 * Close the campaign because the shift was filled. Called from assignWorker.
 *
 * Unlike every other transition this one is allowed FROM a terminal state:
 * bidding outlives outreach, so awarding a bid that arrived after "Stop
 * outreach" or after the tiers ran out is the normal way such a shift gets
 * filled, and the dashboard should then say FILLED with a time to fill.
 * `endedAt` keeps recording when outreach ended; a running campaign gets it
 * stamped now.
 *
 * Both writes are conditional on the status still being fillable, so a
 * concurrent Stop or exhaust can never be overwritten with a stale `endedAt`,
 * and a second award (or a racing engine FILL) is a no-op rather than a
 * double close.
 */
export async function markCampaignFilled(
  shiftId: string,
  actor: CampaignActor
): Promise<CampaignControlResult> {
  const campaign = await loadCampaignSnapshot(shiftId);
  if (!campaign) return { ok: false, reason: "NO_CAMPAIGN" };
  if (!FILLABLE.includes(campaign.status)) return { ok: false, reason: "TERMINAL" };

  const now = new Date();
  // Still running: outreach ends with the fill.
  let { count } = await db.calloutCampaign.updateMany({
    where: { shiftId, status: { in: FILLABLE }, endedAt: null },
    data: { status: "FILLED", filledAt: now, endedAt: now },
  });
  if (count === 0) {
    // Outreach had already ended (Stop / exhaustion): keep its endedAt.
    ({ count } = await db.calloutCampaign.updateMany({
      where: { shiftId, status: { in: FILLABLE } },
      data: { status: "FILLED", filledAt: now },
    }));
  }
  if (count === 0) return { ok: false, reason: "TERMINAL" };

  const outreachHadEnded = isCampaignTerminal(campaign.status);
  await logCalloutActivity(
    shiftId,
    actor.actorId,
    "CALLOUT_FILLED",
    outreachHadEnded
      ? "Shift filled from a bid received after outreach had ended; callout closed."
      : "Shift filled; cascade closed."
  );
  await sendCalloutEvent("callout/control", { shiftId, reason: "FILLED" });

  return { ok: true, status: "FILLED", currentTier: campaign.currentTier };
}

/** All tiers have been through their window with no fill. */
export async function exhaustCampaign(
  shiftId: string,
  actor: CampaignActor,
  opts: { fromTier?: number } = {}
): Promise<CampaignControlResult> {
  const result = await setCampaignStatus(shiftId, "EXHAUSTED", actor, {
    from: movableFrom(actor),
    fromTier: opts.fromTier,
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

  // Claimed conditionally so two engine steps (or a retry) remind once.
  const claimed = await transition(
    shiftId,
    { pastStartReminderAt: null },
    { pastStartReminderAt: new Date() },
    {
      actorId: campaign.shift.createdById,
      action: "CALLOUT_PAST_START",
      details: "Shift start passed while unfilled; scheduler reminded (callout left open).",
    }
  );
  if (!claimed) return false;
  await notifySchedulerOfCallout({
    schedulerId: campaign.shift.createdById,
    type: "CALLOUT_REMINDER",
    title: "Shift started unfilled",
    message: `${campaign.shift.title} has passed its start time and is still unfilled. It remains open for bidding.`,
    shiftId,
  });
  return true;
}

async function setCampaignStatus(
  shiftId: string,
  status: CampaignStatus,
  actor: CampaignActor,
  opts: {
    /** Statuses this transition applies from; the write is conditional on them. */
    from: CampaignStatus[];
    /** When set, also only from this tier (an exhaust decided at the last tier). */
    fromTier?: number;
    action: string;
    details: string;
    endsCampaign?: boolean;
  }
): Promise<CampaignControlResult> {
  const campaign = await loadCampaignSnapshot(shiftId);
  if (!campaign) return { ok: false, reason: "NO_CAMPAIGN" };
  if (isCampaignTerminal(campaign.status)) return { ok: false, reason: "TERMINAL" };
  if (campaign.shift.status !== "OPEN") return { ok: false, reason: "SHIFT_CLOSED" };

  const now = new Date();
  const moved = await transition(
    shiftId,
    { status: { in: opts.from }, ...(opts.fromTier !== undefined ? { currentTier: opts.fromTier } : {}) },
    { status, ...(opts.endsCampaign ? { endedAt: now } : {}) },
    { actorId: actor.actorId, action: opts.action, details: opts.details }
  );
  if (!moved) return lostRace(shiftId);
  await sendCalloutEvent("callout/control", { shiftId, reason: status });

  const fresh = await loadCampaignSnapshot(shiftId);
  return { ok: true, status, currentTier: fresh?.currentTier ?? campaign.currentTier };
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
    // Pinned to the tier the decision was made on, so a scheduler's advance
    // landing between the engine's read and its write is not doubled.
    case "ADVANCE":
      await advanceCampaignTier(shiftId, actor, { fromTier: (decision.toTier ?? 2) - 1 });
      break;
    case "EXHAUST":
      await exhaustCampaign(shiftId, actor, { fromTier: MAX_TIER });
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
