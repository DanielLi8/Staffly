import { describe, it, expect, vi } from "vitest";

// Both modules also export a DB-reading describer; only the pure halves are tested here.
vi.mock("@/lib/db", () => ({ db: {} }));

import { shiftConflictMessage, type ShiftConflictState } from "@/lib/shifts/conflict";
import { campaignConflictMessage, type CampaignConflictState } from "@/lib/callout/conflict";
import { formatShiftRange } from "@/lib/utils";

/**
 * What the admin who LOST a race is told. These sentences are the whole point
 * of the typed failures: they must name what happened and, when known, who did
 * it - never a bare "something changed" when we know better.
 */

const startsAt = new Date("2030-01-07T12:00:00Z");
const endsAt = new Date("2030-01-08T00:00:00Z");

function shift(overrides: Partial<ShiftConflictState>): ShiftConflictState {
  return { status: "OPEN", startsAt, endsAt, assigneeName: null, lastChange: null, ...overrides };
}

describe("shiftConflictMessage", () => {
  it("names the assignee and the admin who awarded the shift", () => {
    expect(
      shiftConflictMessage(
        shift({
          status: "ASSIGNED",
          assigneeName: "Maria Lopez",
          lastChange: { action: "WORKER_ASSIGNED", actorName: "James Okafor" },
        })
      )
    ).toBe("This shift was just awarded to Maria Lopez by James Okafor.");
  });

  it("names who cancelled it", () => {
    expect(
      shiftConflictMessage(
        shift({ status: "CANCELLED", lastChange: { action: "SHIFT_CANCELLED", actorName: "Sarah Chen" } })
      )
    ).toBe("This shift was just cancelled by Sarah Chen.");
  });

  it("states the new hours after another admin's time edit", () => {
    expect(
      shiftConflictMessage(shift({ lastChange: { action: "SHIFT_TIME_EDITED", actorName: "Sarah Chen" } }))
    ).toBe(`Sarah Chen just changed this shift's hours to ${formatShiftRange(startsAt, endsAt)}.`);
  });

  it("explains a reassignment by an approved swap", () => {
    expect(
      shiftConflictMessage(
        shift({
          status: "ASSIGNED",
          assigneeName: "Priya Sharma",
          lastChange: { action: "SHIFT_GIVEAWAY_REASSIGNED", actorName: "Sarah Chen" },
        })
      )
    ).toBe("This shift was just reassigned to Priya Sharma by a swap Sarah Chen approved.");
  });

  it("never credits an actor whose last action was something else", () => {
    // Cancelled, but the latest recorded change is an award: don't say "cancelled by" the awarder.
    expect(
      shiftConflictMessage(
        shift({ status: "CANCELLED", lastChange: { action: "WORKER_ASSIGNED", actorName: "James Okafor" } })
      )
    ).toBe("This shift was just cancelled.");
  });
});

function campaign(overrides: Partial<CampaignConflictState>): CampaignConflictState {
  return { status: "RUNNING", currentTier: 1, lastChange: null, ...overrides };
}

describe("campaignConflictMessage", () => {
  it("Stop: names who stopped outreach", () => {
    expect(
      campaignConflictMessage(
        campaign({
          status: "CANCELLED",
          lastChange: { action: "CALLOUT_STOPPED", actorName: "Sarah Chen", details: "Outreach stopped by scheduler" },
        })
      )
    ).toBe("Outreach was just stopped by Sarah Chen.");
  });

  it("Advance: names who advanced, with the tier it is on now", () => {
    expect(
      campaignConflictMessage(
        campaign({
          currentTier: 2,
          lastChange: { action: "CALLOUT_ESCALATED", actorName: "James Okafor", details: "Escalated to tier 2; 3 staff contacted." },
        })
      )
    ).toBe("James Okafor just advanced this callout to tier 2.");
  });

  it("an automatic escalation is not credited to the scheduler it runs as", () => {
    expect(
      campaignConflictMessage(
        campaign({
          currentTier: 3,
          lastChange: { action: "CALLOUT_ESCALATED", actorName: "Sarah Chen", details: "Auto-escalated to tier 3; 4 staff contacted." },
        })
      )
    ).toBe("This callout just advanced automatically to tier 3.");
  });

  it("Hold: names who put it on hold", () => {
    expect(
      campaignConflictMessage(
        campaign({ status: "PAUSED", lastChange: { action: "CALLOUT_HELD", actorName: "James Okafor", details: null } })
      )
    ).toBe("James Okafor just put this callout on hold.");
  });

  it("filled and exhausted callouts say so", () => {
    expect(campaignConflictMessage(campaign({ status: "FILLED" }))).toBe(
      "This callout just closed because the shift was filled."
    );
    expect(campaignConflictMessage(campaign({ status: "EXHAUSTED" }))).toBe(
      "This callout has already run through every tier."
    );
  });
});
