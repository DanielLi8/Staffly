import { describe, it, expect } from "vitest";
import {
  buildTierRoster,
  candidatesForTier,
  nextTier,
  tierFor,
  windowsOverlap,
  type TierCandidate,
} from "@/lib/callout/tiers";

/**
 * Tier targeting is the heart of the cascade: who gets called, when, in what
 * order. It is pure, so it is tested against fixtures rather than a database.
 */

const SHIFT = {
  departmentId: "dept-er",
  startsAt: new Date("2026-08-12T11:00:00Z"),
  endsAt: new Date("2026-08-12T19:00:00Z"),
};

function staff(overrides: Partial<TierCandidate> & { id: string }): TierCandidate {
  return {
    seniorityRank: null,
    hireDate: null,
    departmentIds: [],
    availabilities: [],
    ...overrides,
  };
}

/** An AVAILABLE window that overlaps SHIFT. */
const AVAILABLE_WINDOW = {
  startsAt: new Date("2026-08-12T07:00:00Z"),
  endsAt: new Date("2026-08-12T19:00:00Z"),
  status: "AVAILABLE" as const,
};

describe("windowsOverlap", () => {
  it("is true for genuinely overlapping windows", () => {
    expect(windowsOverlap(AVAILABLE_WINDOW, SHIFT)).toBe(true);
  });

  it("is false for a window that only touches the shift start", () => {
    expect(
      windowsOverlap(
        { startsAt: new Date("2026-08-12T03:00:00Z"), endsAt: SHIFT.startsAt },
        SHIFT
      )
    ).toBe(false);
  });

  it("is false for a window on another day", () => {
    expect(
      windowsOverlap(
        {
          startsAt: new Date("2026-08-14T11:00:00Z"),
          endsAt: new Date("2026-08-14T19:00:00Z"),
        },
        SHIFT
      )
    ).toBe(false);
  });
});

describe("tierFor", () => {
  it("puts department staff with an overlapping AVAILABLE window in tier 1", () => {
    const candidate = staff({
      id: "a",
      departmentIds: ["dept-er"],
      availabilities: [AVAILABLE_WINDOW],
    });
    expect(tierFor(candidate, SHIFT)).toBe(1);
  });

  it("puts department staff with no availability record in tier 2", () => {
    expect(tierFor(staff({ id: "b", departmentIds: ["dept-er"] }), SHIFT)).toBe(2);
  });

  it("puts department staff whose availability misses the window in tier 2", () => {
    const candidate = staff({
      id: "c",
      departmentIds: ["dept-er"],
      availabilities: [
        {
          startsAt: new Date("2026-08-15T07:00:00Z"),
          endsAt: new Date("2026-08-15T19:00:00Z"),
          status: "AVAILABLE",
        },
      ],
    });
    expect(tierFor(candidate, SHIFT)).toBe(2);
  });

  it("treats TENTATIVE as 'nothing declared' - tier 2, not tier 1", () => {
    const candidate = staff({
      id: "d",
      departmentIds: ["dept-er"],
      availabilities: [{ ...AVAILABLE_WINDOW, status: "TENTATIVE" }],
    });
    expect(tierFor(candidate, SHIFT)).toBe(2);
  });

  it("puts eligible staff from another department in tier 3", () => {
    expect(tierFor(staff({ id: "e", departmentIds: ["dept-icu"] }), SHIFT)).toBe(3);
    expect(tierFor(staff({ id: "f", departmentIds: [] }), SHIFT)).toBe(3);
  });

  it("excludes anyone explicitly UNAVAILABLE for the window, in any department", () => {
    const inDept = staff({
      id: "g",
      departmentIds: ["dept-er"],
      availabilities: [{ ...AVAILABLE_WINDOW, status: "UNAVAILABLE" }],
    });
    const otherDept = staff({
      id: "h",
      departmentIds: ["dept-icu"],
      availabilities: [{ ...AVAILABLE_WINDOW, status: "UNAVAILABLE" }],
    });
    expect(tierFor(inDept, SHIFT)).toBeNull();
    expect(tierFor(otherDept, SHIFT)).toBeNull();
  });

  it("prefers a firm AVAILABLE when the same person also has a TENTATIVE window", () => {
    const candidate = staff({
      id: "i",
      departmentIds: ["dept-er"],
      availabilities: [{ ...AVAILABLE_WINDOW, status: "TENTATIVE" }, AVAILABLE_WINDOW],
    });
    expect(tierFor(candidate, SHIFT)).toBe(1);
  });
});

describe("buildTierRoster", () => {
  const senior = staff({
    id: "senior",
    seniorityRank: 1,
    departmentIds: ["dept-er"],
    availabilities: [AVAILABLE_WINDOW],
  });
  const midByRank = staff({
    id: "mid",
    seniorityRank: 4,
    departmentIds: ["dept-er"],
    availabilities: [AVAILABLE_WINDOW],
  });
  const unrankedEarlyHire = staff({
    id: "early",
    hireDate: new Date("2010-01-01"),
    departmentIds: ["dept-er"],
    availabilities: [AVAILABLE_WINDOW],
  });
  const noAvailability = staff({
    id: "no-avail",
    seniorityRank: 2,
    departmentIds: ["dept-er"],
  });
  const otherDept = staff({ id: "other", seniorityRank: 3, departmentIds: ["dept-icu"] });
  const refused = staff({
    id: "refused",
    departmentIds: ["dept-er"],
    availabilities: [{ ...AVAILABLE_WINDOW, status: "UNAVAILABLE" }],
  });

  const pool = [unrankedEarlyHire, midByRank, otherDept, refused, noAvailability, senior];

  it("buckets each candidate into exactly one tier", () => {
    const roster = buildTierRoster(SHIFT, pool);
    expect(roster[1].map((c) => c.id)).toEqual(["senior", "mid", "early"]);
    expect(roster[2].map((c) => c.id)).toEqual(["no-avail"]);
    expect(roster[3].map((c) => c.id)).toEqual(["other"]);
  });

  it("orders each tier most-senior-first, ranked before unranked", () => {
    const roster = buildTierRoster(SHIFT, pool);
    // rank 1 < rank 4 < (unranked, however early the hire date).
    expect(roster[1].map((c) => c.id)).toEqual(["senior", "mid", "early"]);
  });

  it("never includes an UNAVAILABLE candidate in any tier", () => {
    const roster = buildTierRoster(SHIFT, pool);
    const everyone = [...roster[1], ...roster[2], ...roster[3]].map((c) => c.id);
    expect(everyone).not.toContain("refused");
  });

  it("does not mutate the input pool", () => {
    const before = pool.map((c) => c.id);
    buildTierRoster(SHIFT, pool);
    expect(pool.map((c) => c.id)).toEqual(before);
  });

  it("carries extra candidate fields through the roster", () => {
    const withExtra = [{ ...senior, email: "senior@example.com" }];
    const roster = buildTierRoster(SHIFT, withExtra);
    expect(roster[1][0].email).toBe("senior@example.com");
  });

  it("candidatesForTier returns the same list as the roster bucket", () => {
    expect(candidatesForTier(SHIFT, pool, 2).map((c) => c.id)).toEqual(["no-avail"]);
  });
});

describe("nextTier", () => {
  it("widens 1 -> 2 -> 3 and then runs out", () => {
    expect(nextTier(1)).toBe(2);
    expect(nextTier(2)).toBe(3);
    expect(nextTier(3)).toBeNull();
  });
});
