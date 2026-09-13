import { describe, it, expect } from "vitest";
import {
  SWAP_REASSIGNED_ACTION,
  SWAP_REASSIGNED_ACTION_LABEL,
  buildSwapReassignmentDetails,
  firstName,
} from "@/lib/shift-swap/audit";

describe("buildSwapReassignmentDetails", () => {
  it("matches the mockup's audit-trail example verbatim", () => {
    const details = buildSwapReassignmentDetails({
      fromName: "Maria Santos",
      toName: "Thomas Nguyen",
      acceptedByName: "Thomas",
      approvedByName: "Sarah Chen",
    });
    expect(details).toBe("Maria Santos → Thomas Nguyen - accepted by Thomas, approved by Sarah Chen (Admin)");
  });

  it("reverses direction for the other side of a swap", () => {
    const details = buildSwapReassignmentDetails({
      fromName: "Thomas Nguyen",
      toName: "Maria Santos",
      acceptedByName: "Thomas",
      approvedByName: "Sarah Chen",
    });
    expect(details).toBe("Thomas Nguyen → Maria Santos - accepted by Thomas, approved by Sarah Chen (Admin)");
  });
});

describe("firstName", () => {
  it("extracts the first token of a full name", () => {
    expect(firstName("Thomas Nguyen")).toBe("Thomas");
  });

  it("returns the whole string when there is no space", () => {
    expect(firstName("Cher")).toBe("Cher");
  });
});

describe("SWAP_REASSIGNED_ACTION / SWAP_REASSIGNED_ACTION_LABEL", () => {
  it("maps each kind to a distinct action key with a matching label", () => {
    expect(SWAP_REASSIGNED_ACTION.SWAP).toBe("SHIFT_SWAP_REASSIGNED");
    expect(SWAP_REASSIGNED_ACTION.GIVEAWAY).toBe("SHIFT_GIVEAWAY_REASSIGNED");
    expect(SWAP_REASSIGNED_ACTION_LABEL[SWAP_REASSIGNED_ACTION.SWAP]).toBe("Reassigned via Shift Swap");
    expect(SWAP_REASSIGNED_ACTION_LABEL[SWAP_REASSIGNED_ACTION.GIVEAWAY]).toBe("Reassigned via Shift Giveaway");
  });
});
