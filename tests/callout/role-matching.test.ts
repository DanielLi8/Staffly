import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression coverage for the reported bug: an ER "Lead RN" (base clinical
 * position "Registered Nurse", the Lead RN designation carried separately as
 * a tag - see `User.isTeamLead` and `DepartmentMembership.title`) must still
 * be a callout candidate for a shift that needs an RN. Before
 * `loadTierCandidates` filtered by position at all, EVERY department staff
 * member was a candidate regardless of clinical role (no bug to have here);
 * now that it filters by `positionMatchesRole`, this pins down that the
 * filter matches on `position` only and is never affected by the tag, and
 * that a genuinely unqualified position is correctly excluded.
 */

const findManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { user: { findMany: (...args: unknown[]) => findManyMock(...args) } },
}));

import { loadTierCandidates } from "@/lib/callout/campaign";
import { buildTierRoster } from "@/lib/callout/tiers";

const SHIFT = {
  departmentId: "dept-er",
  startsAt: new Date("2026-08-12T11:00:00Z"),
  endsAt: new Date("2026-08-12T19:00:00Z"),
  roleNeeded: "Registered Nurse (RN)",
};

const AVAILABLE_WINDOW = {
  startsAt: new Date("2026-08-12T07:00:00Z"),
  endsAt: new Date("2026-08-12T19:00:00Z"),
  status: "AVAILABLE" as const,
};

function dbUser(overrides: {
  id: string;
  position: string | null;
  departmentIds?: string[];
  availabilities?: { startsAt: Date; endsAt: Date; status: string }[];
}) {
  return {
    id: overrides.id,
    name: overrides.id,
    email: `${overrides.id}@example.com`,
    phone: null,
    phoneVerifiedAt: null,
    position: overrides.position,
    seniorityRank: null,
    hireDate: null,
    departmentMemberships: (overrides.departmentIds ?? ["dept-er"]).map((departmentId) => ({
      departmentId,
    })),
    availabilities: overrides.availabilities ?? [AVAILABLE_WINDOW],
  };
}

beforeEach(() => {
  findManyMock.mockReset();
});

describe("loadTierCandidates role filtering", () => {
  it("includes an ER Lead RN (position Registered Nurse) as a candidate for an RN-required shift, landing in tier 1", async () => {
    findManyMock.mockResolvedValue([
      dbUser({ id: "lead-rn", position: "Registered Nurse" }),
    ]);

    const candidates = await loadTierCandidates(SHIFT);
    expect(candidates.map((c) => c.id)).toEqual(["lead-rn"]);

    const roster = buildTierRoster(SHIFT, candidates);
    expect(roster[1].map((c) => c.id)).toEqual(["lead-rn"]);
  });

  it("excludes a department member whose position does not match the shift's required role", async () => {
    findManyMock.mockResolvedValue([
      dbUser({ id: "lead-rn", position: "Registered Nurse" }),
      dbUser({ id: "psw", position: "Personal Support Worker" }),
    ]);

    const candidates = await loadTierCandidates(SHIFT);
    expect(candidates.map((c) => c.id)).toEqual(["lead-rn"]);
  });

  it("excludes a staff member with no recorded position (fails closed)", async () => {
    findManyMock.mockResolvedValue([dbUser({ id: "no-position", position: null })]);

    const candidates = await loadTierCandidates(SHIFT);
    expect(candidates).toHaveLength(0);
  });
});
