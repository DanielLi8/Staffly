import { describe, it, expect } from "vitest";
import { decideNextStep, windowElapsed, type CampaignState } from "@/lib/callout/decide";

/**
 * Time is INJECTED, so every timing rule is exercised instantly and
 * deterministically - no Inngest, no sleeping, no real minutes.
 */

const SHIFT_START = new Date("2026-08-12T11:00:00Z");
const TIER_ENTERED = new Date("2026-08-12T09:00:00Z");

function campaign(overrides: Partial<CampaignState> = {}): CampaignState {
  return {
    status: "RUNNING",
    currentTier: 1,
    tierEnteredAt: TIER_ENTERED,
    windowMinutes: 15,
    dispatchDueAt: null,
    pastStartReminderAt: null,
    ...overrides,
  };
}

/**
 * A campaign in the state a freshly posted shift leaves it in: nobody contacted,
 * tier 1 due one minute out.
 */
function justPosted(overrides: Partial<CampaignState> = {}): CampaignState {
  return campaign({
    tierEnteredAt: null,
    dispatchDueAt: new Date(TIER_ENTERED.getTime() + 60_000),
    ...overrides,
  });
}

/** `minutes` after the current tier was entered. */
function at(minutes: number): Date {
  return new Date(TIER_ENTERED.getTime() + minutes * 60_000);
}

const OPEN_SHIFT = { status: "OPEN" as const, startsAt: SHIFT_START };

describe("windowElapsed", () => {
  it("is false before the window is up and true at/after it", () => {
    expect(windowElapsed(campaign(), at(14))).toBe(false);
    expect(windowElapsed(campaign(), at(15))).toBe(true);
    expect(windowElapsed(campaign(), at(16))).toBe(true);
  });

  it("is false while the tier has not been entered yet", () => {
    expect(windowElapsed(campaign({ tierEnteredAt: null }), at(999))).toBe(false);
  });
});

describe("decideNextStep - the posting delay holds the opening outreach", () => {
  /** The delay is one minute, so `at(1)` is exactly when it falls due. */
  it("waits while the delay is still running", () => {
    const decision = decideNextStep({ now: at(0.5), campaign: justPosted(), shift: OPEN_SHIFT });
    expect(decision.action).toBe("WAIT");
  });

  it("dispatches tier 1 the moment the delay elapses", () => {
    const decision = decideNextStep({ now: at(1), campaign: justPosted(), shift: OPEN_SHIFT });
    expect(decision.action).toBe("DISPATCH");
    expect(decision.toTier).toBe(1);
  });

  it("never widens straight past an undispatched tier 1, however late the engine runs", () => {
    const decision = decideNextStep({ now: at(600), campaign: justPosted(), shift: OPEN_SHIFT });
    expect(decision.action).toBe("DISPATCH");
  });

  /* The cancel-within-window guarantee, at the level of the pure rule: whatever
     pulls the shift or the campaign wins over a due dispatch. */
  it("does not dispatch once the shift has been cancelled inside the window", () => {
    const decision = decideNextStep({
      now: at(1),
      campaign: justPosted(),
      shift: { status: "CANCELLED", startsAt: SHIFT_START },
    });
    expect(decision.action).toBe("HALT");
  });

  it("does not dispatch once the shift has been filled inside the window", () => {
    const decision = decideNextStep({
      now: at(1),
      campaign: justPosted(),
      shift: { status: "ASSIGNED", startsAt: SHIFT_START },
    });
    expect(decision.action).toBe("FILL");
  });

  it("does not dispatch for a campaign stopped inside the window", () => {
    const decision = decideNextStep({
      now: at(1),
      campaign: justPosted({ status: "CANCELLED" }),
      shift: OPEN_SHIFT,
    });
    expect(decision.action).toBe("HALT");
  });

  it("does not dispatch for a campaign held inside the window", () => {
    const decision = decideNextStep({
      now: at(1),
      campaign: justPosted({ status: "PAUSED" }),
      shift: OPEN_SHIFT,
    });
    expect(decision.action).toBe("WAIT");
  });

  it("still flags a past-start reminder while holding the opening outreach", () => {
    const decision = decideNextStep({
      now: at(121),
      campaign: justPosted({ dispatchDueAt: new Date(TIER_ENTERED.getTime() + 200 * 60_000) }),
      shift: OPEN_SHIFT,
    });
    expect(decision.action).toBe("WAIT");
    expect(decision.remindPastStart).toBe(true);
  });
});

describe("decideNextStep - window elapsed advances a tier", () => {
  it("waits while the tier window is still open", () => {
    const decision = decideNextStep({ now: at(5), campaign: campaign(), shift: OPEN_SHIFT });
    expect(decision.action).toBe("WAIT");
    expect(decision.remindPastStart).toBe(false);
  });

  it("advances tier 1 -> 2 once the window elapses", () => {
    const decision = decideNextStep({ now: at(15), campaign: campaign(), shift: OPEN_SHIFT });
    expect(decision.action).toBe("ADVANCE");
    expect(decision.toTier).toBe(2);
  });

  it("advances tier 2 -> 3 using tier 2's own window", () => {
    const decision = decideNextStep({
      now: at(20),
      campaign: campaign({ currentTier: 2, windowMinutes: 20 }),
      shift: OPEN_SHIFT,
    });
    expect(decision.action).toBe("ADVANCE");
    expect(decision.toTier).toBe(3);
  });

  it("exhausts rather than advancing past the last tier", () => {
    const decision = decideNextStep({
      now: at(30),
      campaign: campaign({ currentTier: 3, windowMinutes: 30 }),
      shift: OPEN_SHIFT,
    });
    expect(decision.action).toBe("EXHAUST");
    expect(decision.toTier).toBeUndefined();
  });
});

describe("decideNextStep - a filled shift stops the cascade", () => {
  it("returns FILL as soon as the shift is ASSIGNED, even mid-window", () => {
    const decision = decideNextStep({
      now: at(1),
      campaign: campaign(),
      shift: { status: "ASSIGNED", startsAt: SHIFT_START },
    });
    expect(decision.action).toBe("FILL");
  });

  it("a fill beats an elapsed window", () => {
    const decision = decideNextStep({
      now: at(600),
      campaign: campaign(),
      shift: { status: "ASSIGNED", startsAt: SHIFT_START },
    });
    expect(decision.action).toBe("FILL");
  });

  it("halts on a cancelled or closed shift", () => {
    for (const status of ["CANCELLED", "CLOSED"] as const) {
      const decision = decideNextStep({
        now: at(600),
        campaign: campaign(),
        shift: { status, startsAt: SHIFT_START },
      });
      expect(decision.action).toBe("HALT");
    }
  });
});

describe("decideNextStep - scheduler state is authoritative", () => {
  it("a stopped campaign halts even with the window long elapsed", () => {
    const decision = decideNextStep({
      now: at(600),
      campaign: campaign({ status: "CANCELLED" }),
      shift: OPEN_SHIFT,
    });
    expect(decision.action).toBe("HALT");
  });

  it("a held campaign waits instead of widening", () => {
    const decision = decideNextStep({
      now: at(600),
      campaign: campaign({ status: "PAUSED" }),
      shift: OPEN_SHIFT,
    });
    expect(decision.action).toBe("WAIT");
  });

  it("an already-exhausted campaign halts", () => {
    const decision = decideNextStep({
      now: at(600),
      campaign: campaign({ status: "EXHAUSTED", currentTier: 3 }),
      shift: OPEN_SHIFT,
    });
    expect(decision.action).toBe("HALT");
  });
});

describe("decideNextStep - past the shift start we remind, never expire", () => {
  /** 11:00 shift start is 120 minutes after the tier was entered at 09:00. */
  const PAST_START = 121;

  it("flags a reminder once the start passes and keeps escalating", () => {
    const decision = decideNextStep({
      now: at(PAST_START),
      campaign: campaign(),
      shift: OPEN_SHIFT,
    });
    expect(decision.remindPastStart).toBe(true);
    // Crucially NOT an expiry/halt: the callout carries on.
    expect(decision.action).toBe("ADVANCE");
  });

  it("does not re-flag once a reminder has already been raised", () => {
    const decision = decideNextStep({
      now: at(PAST_START),
      campaign: campaign({ pastStartReminderAt: new Date("2026-08-12T11:00:30Z") }),
      shift: OPEN_SHIFT,
    });
    expect(decision.remindPastStart).toBe(false);
  });

  it("still only WAITs (with the reminder flagged) when the window is open", () => {
    const decision = decideNextStep({
      now: at(PAST_START),
      campaign: campaign({ windowMinutes: 600 }),
      shift: OPEN_SHIFT,
    });
    expect(decision.action).toBe("WAIT");
    expect(decision.remindPastStart).toBe(true);
  });

  it("flags the reminder alongside EXHAUST on the last tier - the shift stays open", () => {
    const decision = decideNextStep({
      now: at(PAST_START),
      campaign: campaign({ currentTier: 3, windowMinutes: 30 }),
      shift: OPEN_SHIFT,
    });
    expect(decision.action).toBe("EXHAUST");
    expect(decision.remindPastStart).toBe(true);
  });

  it("never flags a reminder for a shift that is already filled", () => {
    const decision = decideNextStep({
      now: at(PAST_START),
      campaign: campaign(),
      shift: { status: "ASSIGNED", startsAt: SHIFT_START },
    });
    expect(decision.remindPastStart).toBe(false);
  });
});
