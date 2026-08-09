/**
 * Tier targeting for the escalation cascade.
 *
 * PURE: no DB, no session, no clock. Callers load the candidate pool once and
 * hand it in; this module decides only *who belongs in which tier and in what
 * order*. That makes the widening policy - the interesting part - unit-testable
 * without a database.
 *
 * The cascade widens outward from the people most likely to say yes:
 *   Tier 1 - department staff who declared themselves AVAILABLE for the window.
 *   Tier 2 - department staff who declared nothing for the window.
 *   Tier 3 - eligible staff in other departments.
 *
 * Each tier is ordered most-senior-first by the Phase 1 {@link rankBySeniority}.
 */
import type { AvailabilityStatus } from "@prisma/client";
import { rankBySeniority } from "@/lib/seniority";

export const TIERS = [1, 2, 3] as const;
export type Tier = (typeof TIERS)[number];

/** The last tier the cascade can reach; past this the campaign is EXHAUSTED. */
export const MAX_TIER: Tier = 3;

export interface CandidateAvailability {
  startsAt: Date;
  endsAt: Date;
  status: AvailabilityStatus;
}

/** The shape of a staff member this module needs. Deliberately not a Prisma type. */
export interface TierCandidate {
  id: string;
  seniorityRank: number | null;
  hireDate: Date | null;
  /** Ids of every department this person is a member of. */
  departmentIds: string[];
  /** Only the availability records that could touch the shift window. */
  availabilities: CandidateAvailability[];
}

export interface TierTargetingShift {
  departmentId: string;
  startsAt: Date;
  endsAt: Date;
}

/** Half-open overlap: windows that merely touch end-to-start do not overlap. */
export function windowsOverlap(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date }
): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

function overlapping(
  candidate: TierCandidate,
  shift: TierTargetingShift
): CandidateAvailability[] {
  return candidate.availabilities.filter((a) => windowsOverlap(a, shift));
}

/**
 * Which tier a single candidate belongs to, or null when they are not called at
 * all.
 *
 * An explicit UNAVAILABLE overlapping the shift removes someone from the whole
 * cascade: they have already said no, and re-calling them is exactly the noise
 * a tiered callout exists to avoid.
 *
 * TENTATIVE is treated as "nothing declared" and lands in tier 2 - it is not a
 * commitment, so it must not outrank a firm AVAILABLE, but it is not a refusal
 * either.
 */
export function tierFor(candidate: TierCandidate, shift: TierTargetingShift): Tier | null {
  const windows = overlapping(candidate, shift);
  if (windows.some((w) => w.status === "UNAVAILABLE")) return null;

  const inDepartment = candidate.departmentIds.includes(shift.departmentId);
  if (!inDepartment) return 3;

  return windows.some((w) => w.status === "AVAILABLE") ? 1 : 2;
}

export type TierRoster<T extends TierCandidate = TierCandidate> = Record<Tier, T[]>;

/**
 * Bucket every candidate into its tier, each bucket ordered most-senior-first.
 * Candidates excluded by an explicit UNAVAILABLE appear in no bucket.
 *
 * Generic over the candidate type so callers can carry extra fields through
 * (the cascade passes staff that are also outreach recipients) without losing
 * them to a widening cast.
 */
export function buildTierRoster<T extends TierCandidate>(
  shift: TierTargetingShift,
  candidates: T[]
): TierRoster<T> {
  const roster: TierRoster<T> = { 1: [], 2: [], 3: [] };
  for (const candidate of candidates) {
    const tier = tierFor(candidate, shift);
    if (tier !== null) roster[tier].push(candidate);
  }
  for (const tier of TIERS) {
    roster[tier] = rankBySeniority(roster[tier]);
  }
  return roster;
}

/** The seniority-ordered candidate list for one tier. */
export function candidatesForTier<T extends TierCandidate>(
  shift: TierTargetingShift,
  candidates: T[],
  tier: Tier
): T[] {
  return buildTierRoster(shift, candidates)[tier];
}

/** The next tier to widen into, or null when the cascade has run out of tiers. */
export function nextTier(current: number): Tier | null {
  const next = current + 1;
  return (TIERS as readonly number[]).includes(next) ? (next as Tier) : null;
}
