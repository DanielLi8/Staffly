import { describe, expect, it } from "vitest";
import { monthPrefix, planMonth, DOUBLES_WANTED, type PlanInput } from "../../prisma/seed-month/plan";
import { planDemoRoster } from "../../prisma/seed-month/roster";
import { SCHEDULE_POLICY } from "@/lib/schedule-rules";
import { payPeriodHours } from "@/lib/schedule-rules/hours";
import { positionMatchesRole } from "@/lib/shifts/role-match";
import { hospitalDate } from "@/lib/timezone";

const MONTH = "2026-11";
const departments = [
  { id: "dept-er", code: "ER", name: "Emergency Department" },
  { id: "dept-med", code: "MED", name: "Medical/Surgical" },
  // No pattern of its own: gets the 8 h default.
  { id: "dept-onc", code: "ONC", name: "Oncology" },
];

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  const roster = planDemoRoster(departments, [], new Set());
  return {
    month: MONTH,
    now: new Date("2026-11-04T19:00:00Z"),
    hospitalId: null,
    policy: SCHEDULE_POLICY,
    admins: [{ id: "admin-1", name: "Sarah Chen" }],
    departments,
    staff: roster.map((r) => ({
      id: r.email,
      name: r.name,
      position: r.position,
      isTeamLead: r.isTeamLead,
      departmentIds: [r.departmentId],
      phoneVerified: false,
      seniorityRank: null,
      hireDate: r.hireDate,
    })),
    occupied: [],
    existingAvailability: [],
    takenSmsCodes: new Set(),
    ...overrides,
  };
}

const plan = planMonth(input());
const staffById = new Map(input().staff.map((s) => [s.id, s]));
const held = plan.shifts.filter((s) => s.status !== "CANCELLED" && s.assignedWorkerId);

describe("planMonth (pnpm seed:month)", () => {
  it("is deterministic, so a re-run replaces rows with the same ids instead of adding new ones", () => {
    expect(planMonth(input())).toEqual(plan);
  });

  it("owns every row it plans through the month prefix, with no duplicate ids", () => {
    const prefix = monthPrefix(MONTH);
    for (const rows of [plan.shifts, plan.bids, plan.activities, plan.campaigns, plan.outreach, plan.declines, plan.swaps, plan.availability, plan.notifications]) {
      const ids = rows.map((r) => r.id!);
      expect(ids.every((id) => id.startsWith(prefix))).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("covers every department every day of the month, and nothing outside it", () => {
    const days = new Set(plan.shifts.map((s) => hospitalDate(s.startsAt as Date)));
    expect(days.size).toBe(30);
    expect(Array.from(days).every((d) => d.startsWith(MONTH))).toBe(true);
    for (const dept of departments) {
      expect(plan.shifts.some((s) => s.departmentId === dept.id)).toBe(true);
    }
  });

  it("uses 12 h shifts where the department runs them and 8 h elsewhere", () => {
    const hours = (deptId: string) =>
      new Set(plan.shifts.filter((s) => s.departmentId === deptId).map((s) => ((s.endsAt as Date).getTime() - (s.startsAt as Date).getTime()) / 3_600_000));
    expect(hours("dept-er")).toEqual(new Set([12]));
    expect(hours("dept-med")).toEqual(new Set([8]));
    expect(hours("dept-onc")).toEqual(new Set([8]));
  });

  it("never double-books anyone into overlapping shifts", () => {
    const byWorker = new Map<string, typeof held>();
    for (const s of held) byWorker.set(s.assignedWorkerId!, [...(byWorker.get(s.assignedWorkerId!) ?? []), s]);
    for (const shifts of Array.from(byWorker.values())) {
      const sorted = [...shifts].sort((a, b) => (a.startsAt as Date).getTime() - (b.startsAt as Date).getTime());
      for (let i = 1; i < sorted.length; i++) {
        expect((sorted[i].startsAt as Date).getTime()).toBeGreaterThanOrEqual((sorted[i - 1].endsAt as Date).getTime());
      }
    }
  });

  it("only assigns people whose position matches the role, and never on a day they're unavailable", () => {
    for (const s of held) {
      expect(positionMatchesRole(staffById.get(s.assignedWorkerId!)!.position, s.roleNeeded)).toBe(true);
      const off = plan.availability.filter(
        (a) => a.userId === s.assignedWorkerId && a.status === "UNAVAILABLE" && (a.startsAt as Date) < (s.endsAt as Date) && (s.startsAt as Date) < (a.endsAt as Date)
      );
      expect(off).toEqual([]);
    }
  });

  it("leaves a believable share of shifts open, with callouts on every one", () => {
    const open = plan.shifts.filter((s) => s.status === "OPEN");
    expect(open.length / plan.shifts.length).toBeGreaterThan(0.02);
    expect(open.length / plan.shifts.length).toBeLessThan(0.15);
    const campaigns = new Set(plan.campaigns.map((c) => c.shiftId));
    expect(open.every((s) => campaigns.has(s.id!))).toBe(true);
    expect(open.every((s) => s.smsCode)).toBe(true);
  });

  it("puts a few people over the 75 h pay-period line and books the back-to-back doubles", () => {
    const windows = (worker: string) => held.filter((s) => s.assignedWorkerId === worker).map((s) => ({ startsAt: s.startsAt as Date, endsAt: s.endsAt as Date }));
    const over = Array.from(new Set(held.map((s) => s.assignedWorkerId!))).filter((w) =>
      windows(w).some((s) => payPeriodHours(windows(w), s.startsAt) >= SCHEDULE_POLICY.payPeriodOvertimeHours)
    );
    expect(over.length).toBeGreaterThanOrEqual(2);
    expect(plan.doubles).toHaveLength(DOUBLES_WANTED);
  });

  it("keeps at most one active swap request per shift, each on shifts the requester and target hold", () => {
    const active = plan.swaps.filter((s) => ["PENDING_ACCEPT", "ACCEPTED", "PENDING_APPROVAL"].includes(s.status!));
    expect(new Set(active.map((s) => s.giveShiftId)).size).toBe(active.length);
    for (const swap of active) {
      expect(plan.shifts.find((s) => s.id === swap.giveShiftId)!.assignedWorkerId).toBe(swap.requesterId);
      if (swap.receiveShiftId) expect(plan.shifts.find((s) => s.id === swap.receiveShiftId)!.assignedWorkerId).toBe(swap.targetUserId);
    }
  });

  it("works around shifts people already hold outside the generated rows", () => {
    const worker = held[0].assignedWorkerId!;
    const blocker = { userId: worker, startsAt: held[0].startsAt as Date, endsAt: held[0].endsAt as Date };
    const replanned = planMonth(input({ occupied: [blocker] }));
    const clash = replanned.shifts.filter(
      (s) => s.assignedWorkerId === worker && s.status !== "CANCELLED" && (s.startsAt as Date) < blocker.endsAt && blocker.startsAt < (s.endsAt as Date)
    );
    expect(clash).toEqual([]);
  });
});
