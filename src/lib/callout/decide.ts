/**
 * The cascade's decision logic.
 *
 * PURE, with time injected as `now`. Every timing rule the engine relies on lives
 * here so it can be tested without Inngest, without a database, and without
 * waiting for real minutes to pass. The Inngest function is then a thin driver:
 * read state -> decide -> apply -> repeat.
 */
import { MAX_TIER, nextTier, type Tier } from "./tiers";

export type CampaignAction =
  /** Nothing to do yet - keep waiting out the current tier window. */
  | "WAIT"
  /** The opening delay has elapsed: send the held-back tier-1 outreach now. */
  | "DISPATCH"
  /** Widen to `toTier` and fire that tier's outreach. */
  | "ADVANCE"
  /** Final tier's window elapsed with the shift still open. */
  | "EXHAUST"
  /** The shift got filled - close the campaign out. */
  | "FILL"
  /** Campaign is already in a terminal or held state; the engine must stop/idle. */
  | "HALT";

export interface CampaignDecision {
  action: CampaignAction;
  /** Set for ADVANCE and DISPATCH. */
  toTier?: Tier;
  /**
   * The shift start has passed while the shift is still unfilled and no reminder
   * has been raised yet. Deliberately a FLAG rather than an action: a past-start
   * callout is never auto-expired, it just needs a human. The cascade carries on.
   */
  remindPastStart: boolean;
  /** Human-readable rationale, surfaced in logs and the activity trail. */
  reason: string;
}

export interface CampaignState {
  status: "RUNNING" | "PAUSED" | "CANCELLED" | "FILLED" | "EXHAUSTED";
  currentTier: number;
  /** When the current tier was entered. Null means the tier has not started yet. */
  tierEnteredAt: Date | null;
  /** Window length in minutes for the CURRENT tier. */
  windowMinutes: number;
  /**
   * When the held-back opening outreach falls due. Non-null means NOBODY has
   * been contacted yet: the campaign is inside its posting delay, and the only
   * two outcomes are DISPATCH once the delay elapses or nothing at all if the
   * shift is pulled first. Null once tier 1 has gone out.
   */
  dispatchDueAt: Date | null;
  pastStartReminderAt: Date | null;
}

export interface DecisionShift {
  status: "OPEN" | "ASSIGNED" | "CLOSED" | "CANCELLED";
  startsAt: Date;
}

const MINUTE_MS = 60_000;

/** Whether the current tier's window has run out as of `now`. */
export function windowElapsed(state: CampaignState, now: Date): boolean {
  if (!state.tierEnteredAt) return false;
  return now.getTime() - state.tierEnteredAt.getTime() >= state.windowMinutes * MINUTE_MS;
}

/**
 * Decide what the engine should do next for one campaign, at time `now`.
 *
 * Precedence:
 *   1. A filled/closed shift always wins - stop escalating immediately.
 *   2. A terminal or paused campaign halts; a scheduler "hold"/"stop" is
 *      authoritative and the engine must not override it.
 *   3. A campaign still inside its posting delay either waits or DISPATCHes.
 *      Both (1) and (2) are checked first, which is what makes "cancel before
 *      anyone is contacted" work: the shift is pulled, so we never reach here.
 *   4. Otherwise: window elapsed -> widen a tier, or EXHAUST past the last tier.
 *
 * The past-start reminder is orthogonal and rides along on whichever action
 * results, so a late callout both notifies the scheduler and keeps escalating.
 */
export function decideNextStep(input: {
  now: Date;
  campaign: CampaignState;
  shift: DecisionShift;
}): CampaignDecision {
  const { now, campaign, shift } = input;

  // (1) The shift is no longer takeable: filled, closed, or cancelled.
  if (shift.status === "ASSIGNED") {
    return { action: "FILL", remindPastStart: false, reason: "Shift was filled." };
  }
  if (shift.status !== "OPEN") {
    return { action: "HALT", remindPastStart: false, reason: `Shift is ${shift.status}.` };
  }

  // (2) Scheduler-owned state wins over anything the engine would like to do.
  if (campaign.status === "CANCELLED") {
    return { action: "HALT", remindPastStart: false, reason: "Campaign was stopped." };
  }
  if (campaign.status === "FILLED" || campaign.status === "EXHAUSTED") {
    return {
      action: "HALT",
      remindPastStart: false,
      reason: `Campaign is ${campaign.status}.`,
    };
  }
  if (campaign.status === "PAUSED") {
    return { action: "WAIT", remindPastStart: false, reason: "Campaign is on hold." };
  }

  // No auto-expiry: past the shift start we nudge a human, we never close it.
  const remindPastStart = now >= shift.startsAt && campaign.pastStartReminderAt === null;

  // (3) The opening outreach is still held back. Nothing else can happen to a
  //     campaign that has not contacted anyone yet, so this short-circuits.
  if (campaign.dispatchDueAt) {
    if (now < campaign.dispatchDueAt) {
      return { action: "WAIT", remindPastStart, reason: "Opening outreach not due yet." };
    }
    return {
      action: "DISPATCH",
      toTier: 1,
      remindPastStart,
      reason: "Posting delay elapsed; sending tier-1 outreach.",
    };
  }

  // (4) Time-driven widening.
  if (!windowElapsed(campaign, now)) {
    return { action: "WAIT", remindPastStart, reason: "Tier window still open." };
  }

  const next = nextTier(campaign.currentTier);
  if (next === null) {
    return {
      action: "EXHAUST",
      remindPastStart,
      reason: `Tier ${MAX_TIER} window elapsed with no fill.`,
    };
  }

  return {
    action: "ADVANCE",
    toTier: next,
    remindPastStart,
    reason: `Tier ${campaign.currentTier} window elapsed; widening to tier ${next}.`,
  };
}
