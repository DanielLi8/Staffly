import { describe, it, expect } from "vitest";
import {
  evaluateAssignment,
  schedulePolicyFor,
  type ScheduleContext,
  type SchedulePerson,
  type CandidateShift,
} from "@/lib/schedule-rules";
import { hospitalInstant } from "@/lib/timezone";
import { DAY, EVENING, NIGHT, NOW, candidate, everyOtherDay12h, shift } from "./fixtures";

const CONTEXTS: ScheduleContext[] = ["PLANNING", "AWARD", "POST_PUBLISH_OVERRIDE"];

function person(overrides: Partial<SchedulePerson> = {}): SchedulePerson {
  return { position: "Registered Nurse", shifts: [], ...overrides };
}

function evaluate(
  target: CandidateShift,
  who: Partial<SchedulePerson> = {},
  context: ScheduleContext = "AWARD",
  now = NOW
) {
  return evaluateAssignment({ shift: target, person: person(who), now, context });
}

function rules(result: ReturnType<typeof evaluate>) {
  return result.issues.map((i) => `${i.rule}:${i.severity}`);
}

describe("evaluateAssignment - a clean booking", () => {
  it.each(CONTEXTS)("has no issues and is straight time (%s)", (context) => {
    const result = evaluate(candidate("2026-10-20", DAY), {}, context);
    expect(result.issues).toEqual([]);
    expect(result.blocked).toBe(false);
    expect(result.needsReason).toBe(false);
    expect(result.payType.payType).toBe("STRAIGHT");
    expect(result.context).toBe(context);
  });
});

describe("OVERLAP - blocked in every context", () => {
  it.each(CONTEXTS)("blocks the same shift time (%s)", (context) => {
    const result = evaluate(candidate("2026-10-20", DAY), { shifts: [shift("s1", "2026-10-20", DAY)] }, context);
    expect(result.blocked).toBe(true);
    expect(result.issues[0]).toMatchObject({
      rule: "OVERLAP",
      severity: "BLOCK",
      message: "Already on Day 07-15 Tue Oct 20",
      relatedShiftId: "s1",
    });
  });

  it("blocks a partial overlap", () => {
    const result = evaluate(candidate("2026-10-20", [11, 19]), { shifts: [shift("s1", "2026-10-20", DAY)] });
    expect(rules(result)).toContain("OVERLAP:BLOCK");
  });

  it("blocks a shift inside a night that started the evening before (overnight-aware)", () => {
    const night = shift("n1", "2026-10-20", NIGHT); // Tue 23:00 -> Wed 07:00
    const result = evaluate(candidate("2026-10-21", [5, 13]), { shifts: [night] });
    expect(result.issues[0]).toMatchObject({ rule: "OVERLAP", message: "Already on Night 23-07 Tue Oct 20" });
  });

  it("blocks a night that runs into the next morning's shift", () => {
    const result = evaluate(candidate("2026-10-20", NIGHT), { shifts: [shift("d1", "2026-10-21", [6, 14])] });
    expect(rules(result)).toContain("OVERLAP:BLOCK");
  });

  it("treats shifts as half-open: Day 07-15 then Evening 15-23 is a double, not an overlap", () => {
    const result = evaluate(candidate("2026-10-20", EVENING), { shifts: [shift("d1", "2026-10-20", DAY)] });
    expect(rules(result)).not.toContain("OVERLAP:BLOCK");
    expect(rules(result)).toContain("REST_GAP:NEEDS_REASON");
  });

  it("treats Night 23-07 then Day 07-15 as half-open too", () => {
    const result = evaluate(candidate("2026-10-21", DAY), { shifts: [shift("n1", "2026-10-20", NIGHT)] });
    expect(rules(result)).not.toContain("OVERLAP:BLOCK");
  });

  it("blocks across departments and names the other department", () => {
    const surgery = shift("s1", "2026-10-20", DAY, { departmentId: "surg", departmentName: "Surgery" });
    const result = evaluate(candidate("2026-10-20", DAY, { departmentId: "med" }), { shifts: [surgery] });
    expect(result.issues[0].message).toBe("Already on Day 07-15 Tue Oct 20 (Surgery)");
  });

  it("reports every overlapping shift", () => {
    const result = evaluate(candidate("2026-10-20", [7, 19]), {
      shifts: [shift("a", "2026-10-20", [6, 10]), shift("b", "2026-10-20", [16, 20])],
    });
    expect(result.issues.filter((i) => i.rule === "OVERLAP").map((i) => i.relatedShiftId)).toEqual(["a", "b"]);
  });

  it("ignores a cancelled shift and the candidate itself (re-evaluating an assigned shift)", () => {
    const result = evaluate(candidate("2026-10-20", DAY), {
      shifts: [shift("x", "2026-10-20", DAY, { status: "CANCELLED" }), shift("candidate", "2026-10-20", DAY)],
    });
    expect(result.issues).toEqual([]);
  });
});

describe("REST_GAP - short rest and back-to-back doubles", () => {
  const evening = shift("e1", "2026-10-20", EVENING); // Tue 15-23
  const nextDay = candidate("2026-10-21", DAY); // Wed 07-15: 8 h after it

  it("flags short rest before the shift", () => {
    const result = evaluate(nextDay, { shifts: [evening] });
    expect(result.issues).toEqual([
      {
        rule: "REST_GAP",
        severity: "NEEDS_REASON",
        message: "8 h rest after Evening 15-23 Tue Oct 20 - minimum is 12 h",
        relatedShiftId: "e1",
      },
    ]);
  });

  it("flags short rest after the shift", () => {
    const result = evaluate(candidate("2026-10-20", EVENING), { shifts: [shift("d2", "2026-10-21", DAY)] });
    expect(result.issues[0].message).toBe("8 h rest before Day 07-15 Wed Oct 21 - minimum is 12 h");
  });

  it("flags both sides at once", () => {
    const result = evaluate(candidate("2026-10-20", EVENING), {
      shifts: [shift("d1", "2026-10-20", DAY), shift("n1", "2026-10-20", NIGHT)],
    });
    expect(result.issues.map((i) => i.message)).toEqual([
      "Back-to-back double after Day 07-15 Tue Oct 20",
      "Back-to-back double before Night 23-07 Tue Oct 20",
    ]);
  });

  it("allows exactly the minimum rest", () => {
    // Day ends Tue 15:00; 12 h later is Wed 03:00.
    const result = evaluate(candidate("2026-10-21", [3, 11]), { shifts: [shift("d1", "2026-10-20", DAY)] });
    expect(result.issues).toEqual([]);
  });

  it("only looks at the nearest shift on each side", () => {
    const result = evaluate(nextDay, { shifts: [shift("d0", "2026-10-20", [7, 11]), evening] });
    expect(result.issues.map((i) => i.relatedShiftId)).toEqual(["e1"]);
  });

  it("uses the hospital's minRestHours setting", () => {
    const policy = schedulePolicyFor({ minRestHours: 8 });
    const at8 = evaluateAssignment({ shift: nextDay, person: person({ shifts: [evening] }), now: NOW, context: "PLANNING", policy });
    expect(at8.issues).toEqual([]);

    const at10 = evaluateAssignment({
      shift: nextDay,
      person: person({ shifts: [evening] }),
      now: NOW,
      context: "PLANNING",
      policy: schedulePolicyFor({ minRestHours: 10 }),
    });
    expect(at10.issues[0].message).toBe("8 h rest after Evening 15-23 Tue Oct 20 - minimum is 10 h");
  });

  it("still calls a back-to-back double a double with no rest rule at all", () => {
    const result = evaluateAssignment({
      shift: candidate("2026-10-20", EVENING),
      person: person({ shifts: [shift("d1", "2026-10-20", DAY)] }),
      now: NOW,
      context: "PLANNING",
      policy: schedulePolicyFor({ minRestHours: 0 }),
    });
    expect(rules(result)).toEqual(["REST_GAP:BLOCK"]);
  });

  it("blocks short rest and doubles while PLANNING (no double booking on initial assignment)", () => {
    expect(rules(evaluate(nextDay, { shifts: [evening] }, "PLANNING"))).toEqual(["REST_GAP:BLOCK"]);
    const double = evaluate(candidate("2026-10-20", EVENING), { shifts: [shift("d1", "2026-10-20", DAY)] }, "PLANNING");
    expect(double.blocked).toBe(true);
  });

  it.each(["AWARD", "POST_PUBLISH_OVERRIDE"] as const)("allows double booking with a reason in %s", (context) => {
    const result = evaluate(candidate("2026-10-20", EVENING), { shifts: [shift("d1", "2026-10-20", DAY)] }, context);
    expect(result.blocked).toBe(false);
    expect(result.needsReason).toBe(true);
    expect(result.payType.payType).toBe("OVERTIME");
  });

  it("measures rest in real hours across the DST change", () => {
    // Sat Oct 31 Evening ends 23:00 EDT; Sun Nov 1 07:00 EST is 9 real hours later.
    const result = evaluate(candidate("2026-11-01", DAY), { shifts: [shift("e1", "2026-10-31", EVENING)] });
    expect(result.issues[0].message).toBe("9 h rest after Evening 15-23 Sat Oct 31 - minimum is 12 h");
  });
});

describe("PAY_PERIOD_HOURS and pay type", () => {
  it("is straight time under the line, with the running total", () => {
    const result = evaluate(candidate("2026-10-30", DAY), { shifts: everyOtherDay12h(3) });
    expect(result.payType).toMatchObject({
      payType: "STRAIGHT",
      label: "Straight time",
      overtimeHours: 0,
      reasons: ["36 → 44 h of 75 h - pay period Oct 18-31"],
    });
  });

  const at67 = [...everyOtherDay12h(5), shift("short", "2026-10-28", [7, 14])]; // 60 + 7 = 67 h

  it("is overtime when the shift lands exactly on 75 h (reaching the line counts)", () => {
    const result = evaluate(candidate("2026-10-30", DAY), { shifts: at67 });
    expect(result.payType).toMatchObject({
      payType: "OVERTIME",
      overtimeHours: 0,
      reasons: ["would reach 75 h of 75 h - pay period Oct 18-31"],
      payPeriod: { label: "Oct 18-31", hoursBefore: 67, hoursAfter: 75, overtimeLine: 75 },
    });
    expect(rules(result)).toEqual(["PAY_PERIOD_HOURS:HEADS_UP"]);
  });

  it("is straight time just under 75 h", () => {
    const result = evaluate(candidate("2026-10-30", [7, 14.75]), { shifts: at67 });
    expect(result.payType.payType).toBe("STRAIGHT");
    expect(result.payType.reasons).toEqual(["67 → 74.75 h of 75 h - pay period Oct 18-31"]);
    expect(result.issues).toEqual([]);
  });

  it("counts only the hours past the line as overtime", () => {
    const result = evaluate(candidate("2026-10-30", DAY), { shifts: everyOtherDay12h(6) }); // 72 + 8
    expect(result.payType.overtimeHours).toBe(5);
    expect(result.payType.reasons).toEqual(["would reach 80 h of 75 h - pay period Oct 18-31"]);
  });

  it("makes the whole shift overtime when already at or over the line", () => {
    const shifts = [...everyOtherDay12h(6), shift("d29", "2026-10-29", DAY)]; // 80 h
    const result = evaluate(candidate("2026-10-31", DAY), { shifts });
    expect(result.payType.overtimeHours).toBe(8);
    expect(result.payType.reasons).toEqual(["already at 80 h of 75 h, so all 8 h are overtime - pay period Oct 18-31"]);
  });

  it("blocks pay-period overtime while PLANNING (a schedule is never first posted with overtime)", () => {
    const result = evaluate(candidate("2026-10-30", DAY), { shifts: at67 }, "PLANNING");
    expect(result.blocked).toBe(true);
    expect(result.issues[0]).toMatchObject({
      rule: "PAY_PERIOD_HOURS",
      severity: "BLOCK",
      message: "would reach 75 h of 75 h - pay period Oct 18-31",
    });
  });

  it.each(["AWARD", "POST_PUBLISH_OVERRIDE"] as const)("allows overtime without a reason in %s", (context) => {
    const result = evaluate(candidate("2026-10-30", DAY), { shifts: everyOtherDay12h(6) }, context);
    expect(result.blocked).toBe(false);
    expect(result.needsReason).toBe(false);
    expect(result.payType.payType).toBe("OVERTIME");
  });

  it("counts the 9 h fall-back night in the pay period it starts in", () => {
    // Sat Oct 31 23:00 EDT -> Sun Nov 1 07:00 EST = 9 h, in Oct 18-31.
    const shifts = [...everyOtherDay12h(5), shift("short", "2026-10-28", [7, 13])]; // 66 h
    const night = candidate("2026-10-31", NIGHT);
    expect((night.endsAt.getTime() - night.startsAt.getTime()) / 3_600_000).toBe(9);
    const result = evaluate(night, { shifts });
    expect(result.payType.reasons).toEqual(["would reach 75 h of 75 h - pay period Oct 18-31"]);
  });

  it("starts the count again in the next pay period", () => {
    const result = evaluate(candidate("2026-11-01", DAY), { shifts: everyOtherDay12h(6) });
    expect(result.payType.payType).toBe("STRAIGHT");
    expect(result.payType.reasons).toEqual(["0 → 8 h of 75 h - pay period Nov 1-14"]);
  });

  it("counts hours worked in other departments", () => {
    const shifts = everyOtherDay12h(6).map((s) => ({ ...s, departmentId: "surg" }));
    expect(evaluate(candidate("2026-10-30", DAY), { shifts }).payType.payType).toBe("OVERTIME");
  });

  it("makes a back-to-back double overtime, whole shift, whatever the hours", () => {
    const result = evaluate(candidate("2026-10-20", EVENING), { shifts: [shift("d1", "2026-10-20", DAY)] });
    expect(result.payType).toMatchObject({
      payType: "OVERTIME",
      overtimeHours: 8,
      reasons: ["back-to-back double after Day 07-15 Tue Oct 20"],
    });
  });

  it("makes the reverse order a double too (booked Days before an Evening)", () => {
    const result = evaluate(candidate("2026-10-20", DAY), { shifts: [shift("e1", "2026-10-20", EVENING)] });
    expect(result.payType.reasons).toEqual(["back-to-back double before Evening 15-23 Tue Oct 20"]);
  });

  it("counts a short handover gap as a double but not ordinary short rest", () => {
    const halfHour = evaluate(candidate("2026-10-20", [15.5, 23.5]), { shifts: [shift("d1", "2026-10-20", DAY)] });
    expect(halfHour.payType.payType).toBe("OVERTIME");
    expect(halfHour.payType.reasons).toEqual(["back-to-back double after Day 07-15 Tue Oct 20"]);

    const shortRest = evaluate(candidate("2026-10-21", DAY), { shifts: [shift("e1", "2026-10-20", EVENING)] });
    expect(shortRest.payType.payType).toBe("STRAIGHT");
    expect(shortRest.needsReason).toBe(true);
  });

  it("lists every overtime cause", () => {
    const shifts = [...everyOtherDay12h(5), shift("e30", "2026-10-30", EVENING)]; // 68 h
    const result = evaluate(candidate("2026-10-30", DAY), { shifts });
    expect(result.payType.reasons).toEqual([
      "would reach 76 h of 75 h - pay period Oct 18-31",
      "back-to-back double before Evening 15-23 Fri Oct 30",
    ]);
    expect(result.payType.overtimeHours).toBe(8);
  });
});

describe("UNAVAILABLE and OUTSIDE_AVAILABILITY", () => {
  const unavailable = (from: number, to: number) => ({
    startsAt: hospitalInstant("2026-10-20", from * 60),
    endsAt: hospitalInstant("2026-10-20", to * 60),
    status: "UNAVAILABLE" as const,
  });

  it.each(CONTEXTS)("blocks a declared Not-available block (%s)", (context) => {
    const result = evaluate(candidate("2026-10-20", DAY), { availability: [unavailable(0, 24)] }, context);
    expect(result.issues[0]).toMatchObject({ rule: "UNAVAILABLE", severity: "BLOCK" });
  });

  it("does not block a block that ends as the shift starts", () => {
    expect(evaluate(candidate("2026-10-20", DAY), { availability: [unavailable(0, 7)] }).issues).toEqual([]);
  });

  it("gives a heads-up when declared availability doesn't cover the shift", () => {
    const availability = [
      { startsAt: hospitalInstant("2026-10-20", 19 * 60), endsAt: hospitalInstant("2026-10-20", 31 * 60), status: "AVAILABLE" as const },
    ];
    const result = evaluate(candidate("2026-10-20", DAY), { availability });
    expect(rules(result)).toEqual(["OUTSIDE_AVAILABILITY:HEADS_UP"]);
    expect(result.blocked).toBe(false);
  });
});

describe("TIME_OFF hook", () => {
  const off = (status: string) => ({
    startsAt: hospitalInstant("2026-10-19", 0),
    endsAt: hospitalInstant("2026-10-24", 0),
    status,
  });

  it.each(CONTEXTS)("blocks approved time off (%s)", (context) => {
    const result = evaluate(candidate("2026-10-20", DAY), { timeOff: [off("APPROVED")] }, context);
    expect(result.issues[0]).toMatchObject({ rule: "TIME_OFF", severity: "BLOCK", message: "On approved time off" });
  });

  it("ignores time off that isn't approved", () => {
    expect(evaluate(candidate("2026-10-20", DAY), { timeOff: [off("PENDING")] }).issues).toEqual([]);
  });

  it("ignores time off that only touches the shift", () => {
    expect(evaluate(candidate("2026-10-24", DAY), { timeOff: [off("APPROVED")] }).issues).toEqual([]);
  });
});

describe("ROLE_MISMATCH - fails closed", () => {
  it.each(CONTEXTS)("blocks a position that doesn't match (%s)", (context) => {
    const result = evaluate(candidate("2026-10-20", DAY), { position: "Registered Practical Nurse" }, context);
    expect(result.issues[0]).toMatchObject({
      rule: "ROLE_MISMATCH",
      severity: "BLOCK",
      message: "Registered Practical Nurse doesn't match Registered Nurse (RN)",
    });
  });

  it.each([null, "", "   "])("blocks a missing position (%j)", (position) => {
    const result = evaluate(candidate("2026-10-20", DAY), { position });
    expect(result.issues[0]).toMatchObject({
      rule: "ROLE_MISMATCH",
      message: "No position recorded, so can't fill Registered Nurse (RN)",
    });
  });

  it("matches a position to its abbreviated role label", () => {
    expect(evaluate(candidate("2026-10-20", DAY), { position: "registered nurse" }).issues).toEqual([]);
  });
});

describe("IN_PAST and SHIFT_CLOSED", () => {
  it.each(CONTEXTS)("blocks a shift that has already started (%s)", (context) => {
    const target = candidate("2026-10-20", DAY);
    const result = evaluate(target, {}, context, new Date(target.startsAt.getTime() + 60_000));
    expect(result.issues[0]).toMatchObject({ rule: "IN_PAST", severity: "BLOCK" });
  });

  it("blocks a shift starting exactly now", () => {
    const target = candidate("2026-10-20", DAY);
    expect(rules(evaluate(target, {}, "AWARD", target.startsAt))).toEqual(["IN_PAST:BLOCK"]);
  });

  it.each(["CANCELLED", "CLOSED"])("blocks a %s shift", (status) => {
    const result = evaluate(candidate("2026-10-20", DAY, { status }), {});
    expect(result.issues[0]).toMatchObject({ rule: "SHIFT_CLOSED", message: `This shift is ${status.toLowerCase()}` });
  });

  it("allows an open or assigned shift", () => {
    expect(evaluate(candidate("2026-10-20", DAY, { status: "OPEN" })).issues).toEqual([]);
    expect(evaluate(candidate("2026-10-20", DAY, { status: "ASSIGNED" })).issues).toEqual([]);
  });
});

describe("CONSECUTIVE_DAYS", () => {
  const days = (keys: string[]) => keys.map((k) => shift(k, k, DAY));

  it.each(CONTEXTS)("needs a reason for the 7th day in a row (%s)", (context) => {
    const before = days(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
    const result = evaluate(candidate("2026-10-25", DAY), { shifts: before }, context);
    expect(result.issues.find((i) => i.rule === "CONSECUTIVE_DAYS")).toEqual({
      rule: "CONSECUTIVE_DAYS",
      severity: "NEEDS_REASON",
      message: "Would be 7 days in a row",
    });
  });

  it("counts days on both sides of the shift", () => {
    const around = days(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(rules(evaluate(candidate("2026-10-22", DAY), { shifts: around }))).toEqual(["CONSECUTIVE_DAYS:NEEDS_REASON"]);
  });

  it("is fine at 6 days, and a day off breaks the run", () => {
    const six = days(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
    expect(evaluate(candidate("2026-10-25", DAY), { shifts: six }).issues).toEqual([]);
    const gap = days(["2026-10-18", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
    expect(evaluate(candidate("2026-10-25", DAY), { shifts: gap }).issues).toEqual([]);
  });
});

describe("NOT_DEPARTMENT_MEMBER", () => {
  it("gives a heads-up for a float from another department", () => {
    const result = evaluate(candidate("2026-10-20", DAY, { departmentId: "med" }), { departmentIds: ["surg"] });
    expect(rules(result)).toEqual(["NOT_DEPARTMENT_MEMBER:HEADS_UP"]);
    expect(result.blocked).toBe(false);
  });

  it("is quiet for a member, or when memberships aren't given", () => {
    expect(evaluate(candidate("2026-10-20", DAY), { departmentIds: ["med", "surg"] }).issues).toEqual([]);
    expect(evaluate(candidate("2026-10-20", DAY)).issues).toEqual([]);
  });
});

describe("issue ordering", () => {
  it("lists BLOCK, then NEEDS_REASON, then HEADS_UP", () => {
    const result = evaluate(candidate("2026-10-20", EVENING, { departmentId: "med" }), {
      position: null,
      departmentIds: ["surg"],
      shifts: [shift("d1", "2026-10-20", DAY)],
    });
    expect(rules(result)).toEqual(["ROLE_MISMATCH:BLOCK", "REST_GAP:NEEDS_REASON", "NOT_DEPARTMENT_MEMBER:HEADS_UP"]);
    expect(result.blocked).toBe(true);
    expect(result.needsReason).toBe(true);
  });
});
