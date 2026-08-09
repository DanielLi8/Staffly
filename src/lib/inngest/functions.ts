/**
 * The Inngest cascade engine.
 *
 * Deliberately thin. All state lives in Postgres and all policy lives in
 * src/lib/callout/*; this function only supplies the thing a request/response
 * app cannot: a durable timer. Each iteration re-reads the campaign row, so a
 * scheduler's hold/stop/advance - or a fill arriving by SMS - is honoured on the
 * very next step no matter what this function believed a minute ago.
 *
 * Swapping Inngest for another scheduler means reimplementing this file and
 * nothing else.
 */
import {
  loadCampaignSnapshot,
  stepCampaign,
  toCampaignState,
  windowMinutesForTier,
} from "@/lib/callout/campaign";
import { CALLOUT_CONTROL_EVENT, CALLOUT_STARTED_EVENT, getInngest } from "./client";

/**
 * Hard iteration cap. Three tiers plus holds and control wake-ups will not come
 * close; the cap only stops a pathological loop from running forever.
 */
const MAX_ITERATIONS = 64;

/** Bound on how long a single wait may block, so a held campaign still re-checks. */
const MAX_WAIT_MINUTES = 60;

interface CascadeSnapshot {
  status: string;
  shiftStatus: string;
  tierEnteredAt: string | null;
  windowMinutes: number;
}

/** Read the authoritative campaign state, flattened for a durable step result. */
async function readSnapshot(shiftId: string): Promise<CascadeSnapshot | null> {
  const campaign = await loadCampaignSnapshot(shiftId);
  if (!campaign) return null;
  const state = toCampaignState(campaign);
  return {
    status: campaign.status,
    shiftStatus: campaign.shift.status,
    tierEnteredAt: state.tierEnteredAt ? state.tierEnteredAt.toISOString() : null,
    windowMinutes: windowMinutesForTier(campaign, campaign.currentTier),
  };
}

/** Minutes left in the current tier window, clamped into a sane wait range. */
function remainingWindowMinutes(snapshot: CascadeSnapshot): number {
  const elapsedMs = snapshot.tierEnteredAt
    ? Date.now() - new Date(snapshot.tierEnteredAt).getTime()
    : 0;
  const remaining = Math.ceil(snapshot.windowMinutes - elapsedMs / 60_000);
  return Math.max(1, Math.min(MAX_WAIT_MINUTES, remaining));
}

export function calloutCascadeFunction() {
  const inngest = getInngest();

  return inngest.createFunction(
    {
      id: "callout-cascade",
      name: "Tiered callout cascade",
      triggers: [{ event: CALLOUT_STARTED_EVENT }],
    },
    async ({ event, step }) => {
      const shiftId = (event.data as { shiftId: string }).shiftId;

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        // 1. Re-read authoritative state. Never trust anything carried over from
        //    a previous iteration or from the event payload.
        const snapshot = (await step.run(`load-${i}`, () =>
          readSnapshot(shiftId)
        )) as CascadeSnapshot | null;

        if (!snapshot) return { shiftId, outcome: "no-campaign" };
        if (
          snapshot.status === "CANCELLED" ||
          snapshot.status === "FILLED" ||
          snapshot.status === "EXHAUSTED" ||
          snapshot.shiftStatus !== "OPEN"
        ) {
          return { shiftId, outcome: `halted:${snapshot.status}` };
        }

        // 2. Wait out what remains of this tier's window, but wake early on any
        //    control event (fill / manual advance / hold / stop). The timeout IS
        //    the tier window - racing the wait against it, rather than sleeping
        //    blindly first, is what lets a mid-window stop take effect at once.
        await step.waitForEvent(`await-control-${i}`, {
          event: CALLOUT_CONTROL_EVENT,
          timeout: `${remainingWindowMinutes(snapshot)}m`,
          match: "data.shiftId",
        });

        // 3. Decide and apply against freshly-read state. A control event that
        //    arrived early simply means we re-evaluate sooner; the pure decision
        //    function still says WAIT if the window has not actually elapsed.
        const decision = await step.run(`step-${i}`, () => stepCampaign(shiftId));
        if (!decision) return { shiftId, outcome: "no-campaign" };
        if (
          decision.action === "HALT" ||
          decision.action === "FILL" ||
          decision.action === "EXHAUST"
        ) {
          return { shiftId, outcome: decision.action.toLowerCase() };
        }
      }

      return { shiftId, outcome: "max-iterations" };
    }
  );
}
