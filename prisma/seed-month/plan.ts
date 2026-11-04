/**
 * Plans one month of realistic demo data (`pnpm seed:month`). PURE: no DB, no
 * clock - the writer (`./write.ts`) loads the inputs, passes `now`, and
 * inserts what this returns.
 *
 * What a month looks like:
 * - Every department's shift pattern (`./patterns.ts`) laid out for every
 *   hospital-calendar day of the month, one shift row per head (RN / RPN /
 *   PSW), `roleNeeded` spelled like `User.position` so `positionMatchesRole`
 *   matches.
 * - A published roster, assigned the way the planner must: every rostered
 *   shift passes `evaluateAssignment` in the PLANNING context (no overlap,
 *   12 h rest, no overtime, no 7-day streak, never over an Unavailable day),
 *   with each person on a full- or part-time line under the 75 h line.
 * - ~8% of slots left as holes, which become what a real month has: past
 *   ones awarded through bids (the AWARD context, where overtime is allowed -
 *   that is where the over-75 h people come from) or cancelled; upcoming ones
 *   open with callout campaigns, outreach, declines and pending bids, some
 *   already awarded. Two holes are filled as back-to-back doubles with a
 *   recorded reason.
 * - A handful of Shift Swap / Giveaway requests in every state, and the
 *   notifications each of these would have produced.
 *
 * Every row id starts with `monthPrefix(month)`, which is how the writer
 * finds and replaces exactly the rows a previous run made.
 */
import type { Prisma } from "@prisma/client";
import { buildAvailabilityRows } from "@/lib/availability/build";
import { tierFor, type TierCandidate } from "@/lib/callout/tiers";
import { staffingRoleOf, type StaffingRole } from "@/lib/roles/staffing-role";
import { evaluateAssignment, type SchedulePolicy, type ScheduleShift } from "@/lib/schedule-rules";
import { PAY_PERIOD_ANCHOR, PAY_PERIOD_LENGTH_DAYS } from "@/lib/schedule-rules/pay-period";
import { SWAP_REASSIGNED_ACTION, buildSwapReassignmentDetails, firstName } from "@/lib/shift-swap/audit";
import { positionMatchesRole } from "@/lib/shifts/role-match";
import { classifyShiftType } from "@/lib/shifts/shift-type";
import { addDaysToKey, dayKeysBetween, hospitalDate, hospitalDateTime, hospitalInstant } from "@/lib/timezone";
import { FULL_TIME_HOURS, FULL_TIME_SHARE, PART_TIME_HOURS, patternFor, type ShiftKind, type ShiftTemplate } from "./patterns";
import { chance, hashString, intBetween } from "./random";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Share of slots deliberately left unrostered. */
export const HOLE_RATE = 0.08;
/** Longest run of consecutive days the roster gives anyone (the rule's reason line is 7). */
export const MAX_ROSTERED_STREAK = 5;
/** Back-to-back doubles the generator books. */
export const DOUBLES_WANTED = 2;

const SMS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function monthPrefix(month: string): string {
  return `mseed-${month}-`;
}

export interface PlanDepartment {
  id: string;
  code: string;
  name: string;
}

export interface PlanStaff {
  id: string;
  name: string;
  position: string | null;
  isTeamLead: boolean;
  departmentIds: string[];
  phoneVerified: boolean;
  seniorityRank: number | null;
  hireDate: Date | null;
}

export interface PlanInput {
  /** `yyyy-MM`. */
  month: string;
  now: Date;
  hospitalId: string | null;
  policy: SchedulePolicy;
  /** ADMIN users; the first is the scheduler who posts and awards. */
  admins: Array<{ id: string; name: string }>;
  departments: PlanDepartment[];
  staff: PlanStaff[];
  /** Shifts people already hold that this generator does not own (any department, CANCELLED excluded). */
  occupied: Array<{ userId: string; startsAt: Date; endsAt: Date }>;
  /** Availability rows people already have that this generator does not own. */
  existingAvailability: Array<{ userId: string; startsAt: Date; endsAt: Date; status: "AVAILABLE" | "UNAVAILABLE" | "TENTATIVE" }>;
  /** `Shift.smsCode`s already taken by rows this generator does not own. */
  takenSmsCodes: Set<string>;
}

export interface MonthPlan {
  prefix: string;
  shifts: Prisma.ShiftCreateManyInput[];
  bids: Prisma.ShiftBidCreateManyInput[];
  activities: Prisma.ShiftActivityCreateManyInput[];
  campaigns: Prisma.CalloutCampaignCreateManyInput[];
  outreach: Prisma.OutreachAttemptCreateManyInput[];
  declines: Prisma.ShiftDeclineCreateManyInput[];
  swaps: Prisma.ShiftSwapRequestCreateManyInput[];
  availability: Prisma.AvailabilityCreateManyInput[];
  notifications: Prisma.NotificationCreateManyInput[];
  /** Shift ids booked as back-to-back doubles. */
  doubles: string[];
}

interface Slot {
  id: string;
  dept: PlanDepartment;
  template: ShiftTemplate;
  role: StaffingRole;
  roleNeeded: string;
  dayKey: string;
  startsAt: Date;
  endsAt: Date;
  unit: string;
  location: string;
  title: string;
}

type HoleFate = "AWARDED" | "CANCELLED" | "OPEN";

/** A shift someone holds, with the day / pay-period keys the roster's fast checks use. */
type HeldShift = ScheduleShift & { id: string; dayKey: string; periodKey: string; hours: number };

interface Person extends PlanStaff {
  role: StaffingRole | null;
  capacity: number;
  preferredKind: ShiftKind;
  shifts: HeldShift[];
  availability: Array<{ startsAt: Date; endsAt: Date; status: "AVAILABLE" | "UNAVAILABLE" | "TENTATIVE" }>;
  /** Day keys with an availability row (existing or planned). */
  availabilityDays: Set<string>;
}

const ROLE_LABEL: Record<StaffingRole, string> = {
  RN: "Registered Nurse",
  RPN: "Registered Practical Nurse",
  PSW: "Personal Support Worker",
};

export function planMonth(input: PlanInput): MonthPlan {
  const { month, now, policy } = input;
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`month must be yyyy-MM, got "${month}"`);
  const scheduler = input.admins[0];
  if (!scheduler) throw new Error("planMonth needs at least one ADMIN user");

  const prefix = monthPrefix(month);
  const firstDay = `${month}-01`;
  const lastDay = addDaysToKey(`${nextMonth(month)}-01`, -1);
  const dayKeys = dayKeysBetween(firstDay, lastDay);
  /** The roster was drafted and published two weeks before the month. */
  const publishedAt = hospitalInstant(addDaysToKey(firstDay, -14), 10 * 60);

  const plan: MonthPlan = {
    prefix,
    shifts: [],
    bids: [],
    activities: [],
    campaigns: [],
    outreach: [],
    declines: [],
    swaps: [],
    availability: [],
    notifications: [],
    doubles: [],
  };
  const ids = idMaker(prefix);

  // ---- People -------------------------------------------------------------
  const people = new Map<string, Person>();
  for (const s of input.staff) {
    const role = staffingRoleOf(s.position);
    const kinds = new Set<ShiftKind>();
    for (const deptId of s.departmentIds) {
      const dept = input.departments.find((d) => d.id === deptId);
      if (dept) for (const t of patternFor(dept.code).shifts) kinds.add(t.kind);
    }
    const kindList = Array.from(kinds).sort();
    people.set(s.id, {
      ...s,
      role,
      capacity: chance(`fte-${s.id}`) < FULL_TIME_SHARE ? FULL_TIME_HOURS : PART_TIME_HOURS,
      preferredKind: kindList[hashString(`kind-${s.id}`) % Math.max(kindList.length, 1)] ?? "DAY",
      shifts: input.occupied
        .filter((o) => o.userId === s.id)
        .map((o, i) => held(`existing-${s.id}-${i}`, o.startsAt, o.endsAt, hospitalDate(o.startsAt))),
      availability: input.existingAvailability.filter((a) => a.userId === s.id),
      availabilityDays: new Set(input.existingAvailability.filter((a) => a.userId === s.id).map((a) => hospitalDate(a.startsAt))),
    });
  }
  const staffFor = (deptId: string, role: StaffingRole) =>
    Array.from(people.values()).filter((p) => p.role === role && p.departmentIds.includes(deptId));

  const addAvailability = (person: Person, dayKey: string, block: { status: "AVAILABLE" | "UNAVAILABLE"; startMinute: number; endMinute: number }, createdAt: Date) => {
    const built = buildAvailabilityRows([dayKey], [block]);
    if (!built.ok) throw new Error(built.error);
    for (const row of built.rows) {
      plan.availability.push({
        id: ids.next(`av-${person.id}-${dayKey}`),
        userId: person.id,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        status: row.status,
        createdAt,
      });
      person.availability.push({ startsAt: row.startsAt, endsAt: row.endsAt, status: row.status });
    }
    person.availabilityDays.add(dayKey);
  };

  // ---- Vacation: a few people booked a run of days off -------------------
  for (const person of Array.from(people.values())) {
    if (!person.role || chance(`vac-${month}-${person.id}`) >= 0.12) continue;
    const length = intBetween(`vac-len-${month}-${person.id}`, 3, 5);
    const start = intBetween(`vac-start-${month}-${person.id}`, 0, dayKeys.length - length);
    for (const dayKey of dayKeys.slice(start, start + length)) {
      if (person.availabilityDays.has(dayKey)) continue;
      addAvailability(person, dayKey, { status: "UNAVAILABLE", startMinute: 0, endMinute: 1440 }, addDaysToKeyInstant(firstDay, -20));
    }
  }

  // ---- Slots ---------------------------------------------------------------
  const slots: Slot[] = [];
  for (const dayKey of dayKeys) {
    for (const dept of input.departments) {
      const pattern = patternFor(dept.code);
      for (const template of pattern.shifts) {
        for (const role of ["RN", "RPN", "PSW"] as const) {
          for (let i = 1; i <= (template.needs[role] ?? 0); i++) {
            const startsAt = hospitalInstant(dayKey, template.startMinute);
            const roleNeeded = ROLE_LABEL[role];
            slots.push({
              id: `${prefix}${dept.code}-${dayKey.slice(8)}-${template.kind[0]}-${role}-${i}`.toLowerCase(),
              dept,
              template,
              role,
              roleNeeded,
              dayKey,
              startsAt,
              endsAt: hospitalInstant(dayKey, template.startMinute + template.hours * 60),
              unit: pattern.unit,
              location: pattern.location,
              title: `${dept.name} (${dept.code}) – ${roleNeeded}`,
            });
          }
        }
      }
    }
  }
  slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));

  const candidateShift = (slot: Slot) => ({
    id: slot.id,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    roleNeeded: slot.roleNeeded,
    departmentId: slot.dept.id,
    departmentName: slot.dept.name,
    status: "OPEN",
  });
  // The rule checker only needs the shifts around the candidate (pay period,
  // rest neighbours, a week either side for streaks); passing just those keeps
  // a month of planning fast.
  const evaluate = (slot: Slot, person: Person, at: Date, context: "PLANNING" | "AWARD" | "POST_PUBLISH_OVERRIDE", shifts = person.shifts) =>
    evaluateAssignment({
      shift: candidateShift(slot),
      person: {
        position: person.position,
        departmentIds: person.departmentIds,
        shifts: shifts.filter((s) => Math.abs(s.startsAt.getTime() - slot.startsAt.getTime()) < 16 * DAY),
        availability: person.availability,
      },
      now: at,
      context,
      policy,
    });
  const hold = (person: Person, slot: Slot) =>
    person.shifts.push({ ...held(slot.id, slot.startsAt, slot.endsAt, slot.dayKey), departmentId: slot.dept.id });

  // People who pick up extra shifts whenever they can: one full-time RN per
  // department. The roster fills their line to the top, and the holes they
  // pick up on top of it are where the over-75 h pay periods come from.
  const overtimeProne = new Set<string>();
  for (const dept of input.departments) {
    const fullTimers = Array.from(people.values())
      .filter((p) => p.departmentIds.includes(dept.id) && p.role === "RN" && p.capacity === FULL_TIME_HOURS)
      .sort((a, b) => chance(`ot-${month}-${a.id}`) - chance(`ot-${month}-${b.id}`));
    if (fullTimers[0]) overtimeProne.add(fullTimers[0].id);
  }

  // ---- Published roster (PLANNING rules) ----------------------------------
  const assignee = new Map<string, string>();
  const holes: Slot[] = [];
  for (const slot of slots) {
    if (chance(`hole-${slot.id}`) < HOLE_RATE) {
      holes.push(slot);
      continue;
    }
    // Cheap checks rank the candidates; the rule checker has the final say.
    const ranked = staffFor(slot.dept.id, slot.role)
      .map((person) => ({ person, hours: periodHours(person, slot.dayKey) }))
      .filter(
        ({ person, hours }) =>
          hours + slot.template.hours <= person.capacity &&
          streakWith(person, slot.dayKey) <= MAX_ROSTERED_STREAK &&
          !tooClose(person, slot, policy.minRestHours * HOUR)
      )
      .map(({ person, hours }) => ({ person, score: rosterScore(slot, person, hours) + (overtimeProne.has(person.id) ? 20 : 0) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked.find(({ person }) => {
      const evaluation = evaluate(slot, person, publishedAt, "PLANNING");
      return !evaluation.blocked && !evaluation.needsReason;
    });
    if (!best) {
      holes.push(slot);
      continue;
    }
    assignee.set(slot.id, best.person.id);
    hold(best.person, slot);
  }

  // ---- Holes: doubles first, then awards / cancellations / open callouts ---
  holes.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
  const fates = new Map<string, { fate: HoleFate; winner?: Person; awardAt?: Date; doubleReason?: string }>();

  const pastDouble = findDouble(holes.filter((h) => h.endsAt <= now));
  const upcomingDouble = findDouble(holes.filter((h) => h.startsAt.getTime() > now.getTime() + DAY));
  for (const d of [pastDouble, upcomingDouble].slice(0, DOUBLES_WANTED)) {
    if (!d) continue;
    fates.set(d.slot.id, { fate: "AWARDED", winner: d.person, awardAt: d.awardAt, doubleReason: d.reason });
    hold(d.person, d.slot);
    plan.doubles.push(d.slot.id);
  }

  function findDouble(pool: Slot[]): { slot: Slot; person: Person; awardAt: Date; reason: string } | null {
    for (const slot of pool) {
      if (slot.template.hours !== 8 || fates.has(slot.id)) continue;
      const awardAt = awardTime(slot);
      for (const person of staffFor(slot.dept.id, slot.role)) {
        const adjacent = person.shifts.some(
          (s) => s.endsAt.getTime() === slot.startsAt.getTime() || s.startsAt.getTime() === slot.endsAt.getTime()
        );
        if (!adjacent) continue;
        const evaluation = evaluate(slot, person, awardAt, "AWARD");
        const reasons = evaluation.issues.filter((i) => i.severity === "NEEDS_REASON");
        if (evaluation.blocked || reasons.length !== 1 || !/back-to-back double/i.test(reasons[0].message)) continue;
        return { slot, person, awardAt, reason: reasons[0].message };
      }
    }
    return null;
  }

  function postTime(slot: Slot): Date {
    let posted = new Date(slot.startsAt.getTime() - intBetween(`lead-${slot.id}`, 30, 120) * HOUR);
    if (posted > now) posted = new Date(now.getTime() - intBetween(`recent-${slot.id}`, 2, 72) * HOUR);
    if (posted < publishedAt) posted = new Date(publishedAt.getTime() + HOUR);
    return roundToMinute(posted);
  }
  function awardTime(slot: Slot): Date {
    const posted = postTime(slot);
    const latest = Math.min(slot.startsAt.getTime() - HOUR, now.getTime() - 10 * MINUTE);
    const award = Math.min(posted.getTime() + intBetween(`award-${slot.id}`, 25, 20 * 60) * MINUTE, latest);
    return roundToMinute(new Date(Math.max(award, posted.getTime() + 20 * MINUTE)));
  }

  const awardCandidates = (slot: Slot, at: Date) =>
    staffFor(slot.dept.id, slot.role)
      .map((person) => ({ person, evaluation: evaluate(slot, person, at, "AWARD") }))
      .filter(({ evaluation }) => !evaluation.blocked && !evaluation.needsReason)
      .map(({ person, evaluation }) => ({
        person,
        score:
          (overtimeProne.has(person.id) ? 40 : 0) -
          evaluation.payType.payPeriod.hoursBefore / 4 +
          chance(`bidder-${slot.id}-${person.id}`) * 6,
      }))
      .sort((a, b) => b.score - a.score)
      .map((c) => c.person);

  // Each of them picks up one shift that takes them over the 75 h line.
  for (const id of Array.from(overtimeProne)) {
    const person = people.get(id)!;
    const pickup = holes
      .filter((h) => !fates.has(h.id) && h.role === person.role && person.departmentIds.includes(h.dept.id))
      .sort((a, b) => chance(`ot-${id}-${a.id}`) - chance(`ot-${id}-${b.id}`))
      .find((h) => {
        const evaluation = evaluate(h, person, awardTime(h), "AWARD");
        return !evaluation.blocked && !evaluation.needsReason && evaluation.payType.payType === "OVERTIME";
      });
    if (!pickup) continue;
    fates.set(pickup.id, { fate: "AWARDED", winner: person, awardAt: awardTime(pickup) });
    hold(person, pickup);
  }

  for (const slot of holes) {
    if (fates.has(slot.id)) continue;
    const roll = chance(`fate-${slot.id}`);
    const past = slot.endsAt <= now;
    const started = slot.startsAt <= now;
    const soon = slot.startsAt.getTime() - now.getTime() < 36 * HOUR;
    const wantAward = past ? roll < 0.75 : started ? false : soon ? roll < 0.4 : roll < 0.25;
    if (wantAward) {
      const awardAt = awardTime(slot);
      const winner = awardCandidates(slot, awardAt)[0];
      if (winner) {
        fates.set(slot.id, { fate: "AWARDED", winner, awardAt });
        hold(winner, slot);
        continue;
      }
    }
    // Past holes nobody took were cancelled; a few upcoming ones were pulled when census dropped.
    const cancelled = past || (!started && !soon && roll >= 0.25 && roll < 0.33);
    fates.set(slot.id, { fate: cancelled ? "CANCELLED" : "OPEN" });
  }

  // Open upcoming holes: a couple of free colleagues have said they're available.
  for (const slot of holes) {
    if (fates.get(slot.id)?.fate !== "OPEN" || slot.startsAt <= now) continue;
    const nextDay = addDaysToKey(slot.dayKey, 1);
    const free = staffFor(slot.dept.id, slot.role).filter(
      (p) =>
        !p.availabilityDays.has(slot.dayKey) &&
        !p.shifts.some((s) => [slot.dayKey, nextDay].includes(hospitalDate(s.startsAt))) &&
        !evaluate(slot, p, now, "AWARD").blocked
    );
    const count = intBetween(`avail-count-${slot.id}`, 0, 2);
    free
      .sort((a, b) => chance(`avail-${slot.id}-${a.id}`) - chance(`avail-${slot.id}-${b.id}`))
      .slice(0, count)
      .forEach((p) =>
        addAvailability(
          p,
          slot.dayKey,
          { status: "AVAILABLE", startMinute: slot.template.startMinute, endMinute: (slot.template.startMinute + slot.template.hours * 60) % 1440 },
          new Date(now.getTime() - intBetween(`avail-at-${slot.id}-${p.id}`, 24, 240) * HOUR)
        )
      );
  }

  // ---- Shift rows ----------------------------------------------------------
  const smsCodes = new Set(input.takenSmsCodes);
  const assignedTo = new Map<string, string | null>();
  for (const slot of slots) {
    const fate = fates.get(slot.id);
    const rostered = assignee.get(slot.id);
    const worker = rostered ?? (fate?.fate === "AWARDED" ? fate.winner!.id : null);
    assignedTo.set(slot.id, worker);
    const status = rostered || fate?.fate === "AWARDED" ? "ASSIGNED" : fate?.fate === "CANCELLED" ? "CANCELLED" : "OPEN";
    const posted = rostered ? publishedAt : postTime(slot);
    plan.shifts.push({
      id: slot.id,
      title: slot.title,
      unit: slot.unit,
      departmentId: slot.dept.id,
      roleNeeded: slot.roleNeeded,
      location: slot.location,
      smsCode: rostered ? null : smsCodeFor(slot.id, smsCodes),
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      notes: rostered ? `Rostered ${slot.template.kind.toLowerCase()} shift.` : holeNote(slot, fate?.doubleReason),
      status,
      version: rostered ? 0 : status === "OPEN" ? 1 : 2,
      createdById: scheduler.id,
      assignedWorkerId: worker,
      hospitalId: input.hospitalId,
      createdAt: posted,
    });
    plan.activities.push({
      id: ids.next(`act-${slot.id}`),
      shiftId: slot.id,
      actorId: scheduler.id,
      action: "SHIFT_CREATED",
      details: rostered ? `Rostered on the published ${monthLabel(month)} schedule.` : "Shift posted for callout coverage.",
      createdAt: posted,
    });
    if (!rostered) planCallout(slot, posted, fate!);
  }

  // ---- Callouts for every hole ------------------------------------------------
  function tierTargets(slot: Slot): Record<1 | 2 | 3, Person[]> {
    const tiers: Record<1 | 2 | 3, Person[]> = { 1: [], 2: [], 3: [] };
    for (const p of Array.from(people.values())) {
      if (!positionMatchesRole(p.position, slot.roleNeeded)) continue;
      const candidate: TierCandidate = {
        id: p.id,
        seniorityRank: p.seniorityRank,
        hireDate: p.hireDate,
        departmentIds: p.departmentIds,
        availabilities: p.availability,
      };
      const tier = tierFor(candidate, { departmentId: slot.dept.id, startsAt: slot.startsAt, endsAt: slot.endsAt });
      if (tier) tiers[tier].push(p);
    }
    return tiers;
  }

  function planCallout(slot: Slot, posted: Date, fate: { fate: HoleFate; winner?: Person; awardAt?: Date; doubleReason?: string }) {
    const tiers = tierTargets(slot);
    const tierAt = (tier: number) => new Date(posted.getTime() + MINUTE + [0, 0, 15, 35][tier] * MINUTE);
    const exhaustedAt = new Date(tierAt(3).getTime() + 30 * MINUTE);
    const winner = fate.winner;
    const winnerTier = winner ? ((([1, 2, 3] as const).find((t) => tiers[t].some((p) => p.id === winner.id)) ?? 2) as 1 | 2 | 3) : null;

    let status: "RUNNING" | "PAUSED" | "CANCELLED" | "FILLED" | "EXHAUSTED";
    let reached: 1 | 2 | 3;
    let endedAt: Date | null = null;
    let pastStartReminderAt: Date | null = null;
    const elapsed = (fate.fate === "AWARDED" ? fate.awardAt! : now).getTime() - posted.getTime();
    const naturalTier = (elapsed < 16 * MINUTE ? 1 : elapsed < 36 * MINUTE ? 2 : 3) as 1 | 2 | 3;

    if (fate.fate === "AWARDED") {
      status = "FILLED";
      reached = Math.max(naturalTier === 3 && elapsed < 66 * MINUTE ? 3 : Math.min(naturalTier, 2), winnerTier ?? 1) as 1 | 2 | 3;
      endedAt = elapsed > 66 * MINUTE ? exhaustedAt : fate.awardAt!;
    } else if (fate.fate === "CANCELLED") {
      status = "CANCELLED";
      reached = naturalTier === 3 ? 3 : naturalTier;
      endedAt = new Date(Math.min(slot.startsAt.getTime() - 2 * HOUR, exhaustedAt.getTime() + 6 * HOUR));
    } else if (slot.startsAt <= now) {
      status = "RUNNING";
      reached = 3;
      pastStartReminderAt = new Date(slot.startsAt.getTime() + MINUTE);
    } else if (elapsed < 66 * MINUTE) {
      status = "RUNNING";
      reached = naturalTier;
    } else {
      const roll = chance(`campaign-${slot.id}`);
      status = roll < 0.5 ? "EXHAUSTED" : roll < 0.75 ? "PAUSED" : "CANCELLED";
      reached = status === "PAUSED" ? 2 : 3;
      endedAt = status === "EXHAUSTED" ? exhaustedAt : status === "CANCELLED" ? new Date(tierAt(reached).getTime() + intBetween(`stop-${slot.id}`, 5, 25) * MINUTE) : null;
    }
    if (endedAt && endedAt > now) endedAt = new Date(now.getTime() - MINUTE);

    plan.campaigns.push({
      id: ids.next(`camp-${slot.id}`),
      shiftId: slot.id,
      currentTier: reached,
      status,
      startedAt: posted,
      tier1EnteredAt: tierAt(1),
      tier2EnteredAt: reached >= 2 ? tierAt(2) : null,
      tier3EnteredAt: reached >= 3 ? tierAt(3) : null,
      filledAt: status === "FILLED" ? fate.awardAt! : null,
      endedAt,
      pastStartReminderAt,
      createdAt: posted,
    });

    const activity = (action: string, details: string, at: Date) =>
      plan.activities.push({ id: ids.next(`act-${slot.id}`), shiftId: slot.id, actorId: scheduler.id, action, details, createdAt: at });
    activity("CALLOUT_TIER1_SENT", `Tier 1 callout opened to ${tiers[1].length} available department staff.`, tierAt(1));
    for (const tier of [2, 3] as const) {
      if (reached < tier) break;
      activity(
        "CALLOUT_ESCALATED",
        tiers[tier].length === 0 ? `Tier ${tier} had no candidates; widening further.` : `Auto-escalated to tier ${tier}; ${tiers[tier].length} staff contacted.`,
        tierAt(tier)
      );
    }
    if (status === "EXHAUSTED" || (endedAt && endedAt.getTime() === exhaustedAt.getTime())) {
      activity("CALLOUT_EXHAUSTED", "All 3 tiers contacted with no fill.", exhaustedAt);
    }
    if (status === "PAUSED") activity("CALLOUT_HELD", "Cascade put on hold; no further tiers will open automatically.", new Date(tierAt(2).getTime() + 10 * MINUTE));
    if (status === "CANCELLED" && fate.fate === "OPEN") {
      activity("CALLOUT_STOPPED", "Outreach stopped by scheduler; no further texts or calls will be sent. Bidding stays open.", endedAt!);
    }
    if (pastStartReminderAt) {
      activity("CALLOUT_PAST_START", "Shift start passed while unfilled; scheduler reminded (callout left open).", pastStartReminderAt);
      plan.notifications.push({
        id: ids.next(`n-reminder-${slot.id}`),
        userId: scheduler.id,
        type: "CALLOUT_REMINDER",
        title: "Shift started unfilled",
        message: `${slot.title} has passed its start time and is still unfilled. It remains open for bidding.`,
        shiftId: slot.id,
        read: false,
        createdAt: pastStartReminderAt,
      });
    }

    // Outreach + responses.
    const contacted: Array<{ person: Person; tier: 1 | 2 | 3; at: Date }> = [];
    for (const tier of [1, 2, 3] as const) {
      if (reached < tier) break;
      for (const person of tiers[tier]) contacted.push({ person, tier, at: tierAt(tier) });
    }
    const responders = contacted.filter((c) => c.tier <= 2 && c.person.id !== winner?.id);
    const decliners = responders
      .filter((c) => chance(`decline-${slot.id}-${c.person.id}`) < 0.18)
      .slice(0, 3);
    const declinerIds = new Set(decliners.map((d) => d.person.id));
    const lastResponse = fate.fate === "AWARDED" ? fate.awardAt! : endedAt ?? now;
    const bidders =
      fate.fate === "CANCELLED"
        ? []
        : responders
            .filter((c) => !declinerIds.has(c.person.id) && !evaluate(slot, c.person, c.at, "AWARD").blocked)
            .filter((c) => chance(`bid-${slot.id}-${c.person.id}`) < 0.3)
            .slice(0, 3);
    const bidderIds = new Set(bidders.map((b) => b.person.id));
    const responseAt = (c: { person: Person; at: Date }) =>
      new Date(Math.min(c.at.getTime() + intBetween(`resp-${slot.id}-${c.person.id}`, 2, 50) * MINUTE, lastResponse.getTime() - MINUTE));

    for (const c of contacted) {
      const channels: Array<"IN_APP" | "SMS" | "VOICE"> = c.person.phoneVerified ? ["IN_APP", "SMS", "VOICE"] : ["IN_APP"];
      const answered = c.person.id === winner?.id || bidderIds.has(c.person.id) ? "ACCEPTED" : declinerIds.has(c.person.id) ? "DECLINED" : null;
      for (const channel of channels) {
        const respondedHere = answered && channel === "IN_APP";
        plan.outreach.push({
          id: ids.next(`out-${slot.id}-${c.person.id}-${channel}`),
          shiftId: slot.id,
          userId: c.person.id,
          channel,
          tier: c.tier,
          // Demo runs without Twilio, so SMS/voice are recorded but never leave the queue.
          status: channel === "IN_APP" ? "DELIVERED" : "QUEUED",
          response: respondedHere ? answered : null,
          respondedAt: respondedHere ? responseAt(c) : null,
          createdAt: c.at,
          updatedAt: respondedHere ? responseAt(c) : c.at,
        });
      }
      plan.notifications.push({
        id: ids.next(`n-${slot.id}-${c.person.id}`),
        userId: c.person.id,
        type: "NEW_SHIFT",
        title: "New Shift Available",
        message: `A new callout shift (${slot.title}) is available on ${hospitalDateTime(slot.startsAt)}.`,
        shiftId: slot.id,
        read: slot.startsAt <= now || chance(`read-${slot.id}-${c.person.id}`) < 0.5,
        createdAt: c.at,
      });
    }
    for (const d of decliners) {
      plan.declines.push({
        id: ids.next(`dec-${slot.id}-${d.person.id}`),
        shiftId: slot.id,
        userId: d.person.id,
        source: d.person.phoneVerified ? "SMS" : "IN_APP",
        createdAt: responseAt(d),
        updatedAt: responseAt(d),
      });
    }

    const bidRows = [...bidders.map((b) => ({ person: b.person, at: responseAt(b) }))];
    if (winner) bidRows.unshift({ person: winner, at: new Date(fate.awardAt!.getTime() - intBetween(`win-${slot.id}`, 5, 15) * MINUTE) });
    for (const b of bidRows) {
      const selected = b.person.id === winner?.id;
      plan.bids.push({
        id: ids.next(`bid-${slot.id}-${b.person.id}`),
        shiftId: slot.id,
        workerId: b.person.id,
        note: chance(`note-${slot.id}-${b.person.id}`) < 0.4 ? BID_NOTES[hashString(`note-${slot.id}-${b.person.id}`) % BID_NOTES.length] : null,
        status: fate.fate === "AWARDED" ? (selected ? "SELECTED" : "NOT_SELECTED") : "PENDING",
        createdAt: b.at,
        updatedAt: fate.fate === "AWARDED" ? fate.awardAt! : b.at,
      });
      if (fate.fate === "OPEN") {
        for (const admin of input.admins) {
          plan.notifications.push({
            id: ids.next(`n-bid-${slot.id}-${b.person.id}-${admin.id}`),
            userId: admin.id,
            type: "BID_SUBMITTED",
            title: "New Bid Received",
            message: `${b.person.name} bid on ${slot.title}.`,
            shiftId: slot.id,
            read: slot.startsAt <= now,
            createdAt: b.at,
          });
        }
      }
      if (fate.fate === "AWARDED") {
        plan.notifications.push({
          id: ids.next(`n-award-${slot.id}-${b.person.id}`),
          userId: b.person.id,
          type: selected ? "BID_SELECTED" : "BID_NOT_SELECTED",
          title: selected ? "You've Been Assigned!" : "Shift Filled",
          message: selected
            ? `You were selected for ${slot.title} on ${hospitalDateTime(slot.startsAt)}.`
            : `Another worker was selected for ${slot.title}.`,
          shiftId: slot.id,
          read: slot.startsAt <= now,
          createdAt: fate.awardAt!,
        });
      }
    }

    if (fate.fate === "AWARDED") {
      activity("WORKER_ASSIGNED", `Assigned to ${winner!.name}.${fate.doubleReason ? ` ${fate.doubleReason}; reason: unit short-staffed, approved by ${scheduler.name}.` : ""}`, fate.awardAt!);
      activity("CALLOUT_FILLED", "Callout closed - shift filled.", fate.awardAt!);
    }
    if (fate.fate === "CANCELLED") activity("SHIFT_CANCELLED", "Shift was cancelled by admin.", endedAt!);
  }

  // ---- Shift Swap / Giveaway requests ---------------------------------------
  planSwaps();

  function planSwaps() {
    const used = new Set<string>();
    const swappable = slots
      .filter((s) => assignee.has(s.id) && s.startsAt.getTime() > now.getTime() + 2 * DAY)
      .sort((a, b) => chance(`swap-pick-${a.id}`) - chance(`swap-pick-${b.id}`));
    const recipe: Array<{ kind: "SWAP" | "GIVEAWAY"; status: "PENDING_ACCEPT" | "PENDING_APPROVAL" | "APPROVED" | "DENIED" | "REJECTED" }> = [
      { kind: "SWAP", status: "PENDING_APPROVAL" },
      { kind: "GIVEAWAY", status: "PENDING_APPROVAL" },
      { kind: "SWAP", status: "PENDING_ACCEPT" },
      { kind: "GIVEAWAY", status: "PENDING_ACCEPT" },
      { kind: "SWAP", status: "APPROVED" },
      { kind: "GIVEAWAY", status: "DENIED" },
      { kind: "GIVEAWAY", status: "REJECTED" },
    ];
    const deptUsed = new Map<string, number>();

    const without = (person: Person, shiftId: string) => person.shifts.filter((s) => s.id !== shiftId);
    const fits = (slot: Slot, person: Person, shifts: Person["shifts"], at: Date) => {
      const evaluation = evaluate(slot, person, at, "POST_PUBLISH_OVERRIDE", shifts);
      return !evaluation.blocked && !evaluation.needsReason && evaluation.payType.payType === "STRAIGHT";
    };

    recipe.forEach((step, index) => {
      const requestedAt = roundToMinute(new Date(now.getTime() - intBetween(`swap-at-${month}-${index}`, 3, 60) * HOUR));
      let made = false;
      for (const give of swappable) {
        if (made) break;
        if (used.has(give.id) || (deptUsed.get(give.dept.id) ?? 0) >= 2) continue;
        const requester = people.get(assignee.get(give.id)!)!;
        for (const target of staffFor(give.dept.id, give.role)) {
          if (target.id === requester.id) continue;
          if (step.kind === "GIVEAWAY") {
            if (!fits(give, target, target.shifts, requestedAt)) continue;
            record(step, index, give, null, requester, target, requestedAt);
            made = true;
            break;
          }
          const receive = swappable.find(
            (r) =>
              !used.has(r.id) &&
              r.id !== give.id &&
              assignee.get(r.id) === target.id &&
              r.role === give.role &&
              r.dept.id === give.dept.id &&
              r.dayKey !== give.dayKey
          );
          if (!receive) continue;
          const requesterAfter = without(requester, give.id);
          const targetAfter = without(target, receive.id);
          if (!fits(receive, requester, requesterAfter, requestedAt) || !fits(give, target, targetAfter, requestedAt)) continue;
          record(step, index, give, receive, requester, target, requestedAt);
          made = true;
          break;
        }
      }
    });

    function record(
      step: (typeof recipe)[number],
      index: number,
      give: Slot,
      receive: Slot | null,
      requester: Person,
      target: Person,
      requestedAt: Date
    ) {
      used.add(give.id);
      if (receive) used.add(receive.id);
      deptUsed.set(give.dept.id, (deptUsed.get(give.dept.id) ?? 0) + 1);
      const respondedAt = step.status === "PENDING_ACCEPT" ? null : new Date(requestedAt.getTime() + intBetween(`swap-resp-${index}`, 20, 600) * MINUTE);
      const decidedAt = respondedAt && (step.status === "APPROVED" || step.status === "DENIED") ? new Date(respondedAt.getTime() + intBetween(`swap-dec-${index}`, 30, 300) * MINUTE) : null;
      const clamp = (d: Date | null) => (d && d > now ? new Date(now.getTime() - MINUTE) : d);
      const swapId = ids.next(`swap-${index}`);
      plan.swaps.push({
        id: swapId,
        requesterId: requester.id,
        giveShiftId: give.id,
        kind: step.kind,
        targetUserId: target.id,
        receiveShiftId: receive?.id ?? null,
        status: step.status,
        requestedAt,
        respondedAt: clamp(respondedAt),
        approvedById: decidedAt ? scheduler.id : null,
        approvedAt: clamp(decidedAt),
        createdAt: requestedAt,
      });

      const dateLabel = hospitalDateTime(give.startsAt);
      const kindLabel = step.kind === "SWAP" ? "Shift swap" : "Shift giveaway";
      const notify = (userId: string, type: Prisma.NotificationCreateManyInput["type"], title: string, message: string, at: Date | null) =>
        plan.notifications.push({ id: ids.next(`n-swap-${index}-${userId}`), userId, type, title, message, read: false, createdAt: clamp(at) ?? requestedAt });
      notify(target.id, "SWAP_REQUEST_RECEIVED", "Shift Swap Request", `${requester.name} wants to ${step.kind === "SWAP" ? "swap" : "give away"} their shift on ${dateLabel} with you.`, requestedAt);
      if (step.status === "REJECTED") {
        notify(requester.id, "SWAP_REQUEST_REJECTED", "Shift Swap Declined", `${target.name} declined your request for the shift on ${dateLabel}.`, respondedAt);
      }
      if (step.status === "PENDING_APPROVAL" || step.status === "APPROVED" || step.status === "DENIED") {
        notify(requester.id, "SWAP_REQUEST_ACCEPTED", "Shift Swap Accepted", `${target.name} accepted your request for the shift on ${dateLabel}. Waiting on manager approval.`, respondedAt);
        for (const admin of input.admins) {
          notify(admin.id, "SWAP_APPROVAL_NEEDED", "Shift Swap Needs Approval", `${kindLabel} from ${requester.name} to ${target.name} (shift on ${dateLabel}) was accepted and needs your approval.`, respondedAt);
        }
      }
      if (decidedAt) {
        const approved = step.status === "APPROVED";
        const label = step.kind === "SWAP" ? "shift swap" : "shift giveaway";
        for (const userId of [requester.id, target.id]) {
          notify(
            userId,
            approved ? "SWAP_APPROVED" : "SWAP_DENIED",
            approved ? "Shift Swap Approved" : "Shift Swap Denied",
            `Your ${label} for the shift on ${dateLabel} was ${approved ? "approved" : "denied"} by ${scheduler.name}.`,
            decidedAt
          );
        }
      }

      if (step.status === "APPROVED") {
        const moves: Array<[Slot, Person, Person]> = [[give, requester, target]];
        if (receive) moves.push([receive, target, requester]);
        for (const [slot, from, to] of moves) {
          from.shifts = without(from, slot.id);
          hold(to, slot);
          assignee.set(slot.id, to.id);
          const row = plan.shifts.find((s) => s.id === slot.id)!;
          row.assignedWorkerId = to.id;
          row.version = (row.version ?? 0) + 1;
          plan.activities.push({
            id: ids.next(`act-${slot.id}`),
            shiftId: slot.id,
            actorId: scheduler.id,
            action: SWAP_REASSIGNED_ACTION[step.kind],
            details: buildSwapReassignmentDetails({
              fromName: from.name,
              toName: to.name,
              acceptedByName: firstName(target.name),
              approvedByName: scheduler.name,
            }),
            createdAt: clamp(decidedAt)!,
          });
        }
      }
    }
  }

  return plan;
}

const BID_NOTES = [
  "Can be there 15 minutes early.",
  "Happy to cover - I know the unit.",
  "Available, but would prefer to leave on time.",
  "Can take it if nobody senior wants it.",
  "Free that day, glad to help.",
];

function rosterScore(slot: Slot, person: Person & { capacity: number }, hoursInPeriod: number): number {
  const periodDay = payPeriodDayIndex(slot.dayKey);
  const expected = (person.capacity * (periodDay + 1)) / PAY_PERIOD_LENGTH_DAYS;
  let score = expected - hoursInPeriod;
  if (person.preferredKind === slot.template.kind) score += 6;
  const last = person.shifts.filter((s) => s.startsAt < slot.startsAt).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
  if (last && slot.startsAt.getTime() - last.endsAt.getTime() < 2 * DAY) {
    score += classifyShiftType(last.startsAt, last.endsAt) === slot.template.kind ? 4 : -4;
  }
  if (slot.role === "RN" && slot.id.endsWith("-1") && person.isTeamLead && slot.template.kind === "DAY") score += 5;
  return score + chance(`pick-${slot.id}-${person.id}`) * 3;
}

function held(id: string, startsAt: Date, endsAt: Date, dayKey: string): HeldShift {
  return { id, startsAt, endsAt, status: "ASSIGNED", dayKey, periodKey: payPeriodStartKey(dayKey), hours: (endsAt.getTime() - startsAt.getTime()) / HOUR };
}

/** Hours `person` holds in the pay period `dayKey` falls in. */
function periodHours(person: Person, dayKey: string): number {
  const key = payPeriodStartKey(dayKey);
  return person.shifts.reduce((total, s) => (s.periodKey === key ? total + s.hours : total), 0);
}

/** Consecutive days worked through `dayKey` if they also work `dayKey`. */
function streakWith(person: Person, dayKey: string): number {
  const days = new Set(person.shifts.map((s) => s.dayKey));
  let streak = 1;
  for (let key = addDaysToKey(dayKey, -1); days.has(key); key = addDaysToKey(key, -1)) streak++;
  for (let key = addDaysToKey(dayKey, 1); days.has(key); key = addDaysToKey(key, 1)) streak++;
  return streak;
}

/** Overlaps, or leaves less than `restMs` between, one of `person`'s shifts. */
function tooClose(person: Person, slot: { startsAt: Date; endsAt: Date }, restMs: number): boolean {
  return person.shifts.some((s) => s.startsAt.getTime() < slot.endsAt.getTime() + restMs && slot.startsAt.getTime() < s.endsAt.getTime() + restMs);
}

/** The first day of the pay period `dayKey` falls in. */
function payPeriodStartKey(dayKey: string): string {
  return addDaysToKey(dayKey, -payPeriodDayIndex(dayKey));
}

/** 0-13: the day's position inside its pay period. */
function payPeriodDayIndex(dayKey: string): number {
  const toUtc = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const days = Math.round((toUtc(dayKey) - toUtc(PAY_PERIOD_ANCHOR)) / DAY);
  return ((days % PAY_PERIOD_LENGTH_DAYS) + PAY_PERIOD_LENGTH_DAYS) % PAY_PERIOD_LENGTH_DAYS;
}

function holeNote(slot: Slot, doubleReason?: string): string {
  if (doubleReason) return "Back-to-back double - unit short-staffed.";
  const reasons = ["Sick call - coverage needed.", "Vacancy on the rotation.", "Census up - extra hands needed.", "Leave of absence coverage."];
  return reasons[hashString(`why-${slot.id}`) % reasons.length];
}

function smsCodeFor(shiftId: string, taken: Set<string>): string {
  for (let attempt = 0; ; attempt++) {
    let h = hashString(`sms-${shiftId}-${attempt}`);
    let code = "";
    for (let i = 0; i < 4; i++) {
      code += SMS_CODE_ALPHABET[h % SMS_CODE_ALPHABET.length];
      h = Math.floor(h / SMS_CODE_ALPHABET.length);
    }
    if (!taken.has(code)) {
      taken.add(code);
      return code;
    }
  }
}

function idMaker(prefix: string) {
  const counts = new Map<string, number>();
  return {
    next(key: string): string {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      const base = key.startsWith(prefix) ? key : `${prefix}${key}`;
      return `${base}-${n}`.toLowerCase();
    },
  };
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
}

function addDaysToKeyInstant(dayKey: string, days: number): Date {
  return hospitalInstant(addDaysToKey(dayKey, days), 9 * 60);
}

function roundToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / MINUTE) * MINUTE);
}
