import { describe, it, expect } from "vitest";
import { normalizeRoleLabel, positionMatchesRole } from "@/lib/shifts/role-match";

describe("normalizeRoleLabel", () => {
  it("strips a trailing parenthetical abbreviation", () => {
    expect(normalizeRoleLabel("Registered Nurse (RN)")).toBe("registered nurse");
  });

  it("lowercases and collapses whitespace", () => {
    expect(normalizeRoleLabel("  Trauma   Surgeon ")).toBe("trauma surgeon");
  });

  it("is a no-op for a label with no parenthetical", () => {
    expect(normalizeRoleLabel("Emergency MD")).toBe("emergency md");
  });
});

describe("positionMatchesRole", () => {
  it("matches when the base position equals the shift role once normalized", () => {
    expect(positionMatchesRole("Registered Nurse", "Registered Nurse (RN)")).toBe(true);
  });

  it("matches regardless of case or extra whitespace", () => {
    expect(positionMatchesRole("registered nurse", "Registered Nurse (RN)")).toBe(true);
  });

  it("does not match a different clinical position", () => {
    expect(positionMatchesRole("Personal Support Worker", "Registered Nurse (RN)")).toBe(false);
  });

  it("fails closed when position is null or empty", () => {
    expect(positionMatchesRole(null, "Registered Nurse (RN)")).toBe(false);
    expect(positionMatchesRole("", "Registered Nurse (RN)")).toBe(false);
  });

  it("is unaffected by a Lead RN / Team Lead tag - matching only ever looks at position", () => {
    // isTeamLead is intentionally not a parameter here: the tag must never
    // exclude, nor be required for, ordinary position-based matching.
    expect(positionMatchesRole("Registered Nurse", "Registered Nurse (RN)")).toBe(true);
  });
});
