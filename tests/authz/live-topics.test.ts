import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import {
  formatLiveTopic,
  liveTopicAccess,
  parseLiveTopic,
  type LiveTopic,
} from "@/lib/live/topics";
import { query, type FakeShift } from "./shift-where-eval";

const admin: Actor = { id: "a1", role: "ADMIN" };
const staff: Actor = { id: "w1", role: "STAFF" };
const unknownRole: Actor = { id: "x1", role: "UNIT_CLERK" as Role };

describe("parseLiveTopic", () => {
  it.each<[string, LiveTopic]>([
    ["admin-shift:cmabc123", { kind: "admin-shift", shiftId: "cmabc123" }],
    ["worker-shift:cmabc123", { kind: "worker-shift", shiftId: "cmabc123" }],
    ["admin-shifts", { kind: "admin-shifts" }],
    ["worker-open-shifts", { kind: "worker-open-shifts" }],
    ["worker-bids", { kind: "worker-bids" }],
  ])("parses %s and round-trips it", (raw, topic) => {
    expect(parseLiveTopic(raw)).toEqual(topic);
    expect(formatLiveTopic(topic)).toBe(raw);
  });

  it.each([
    null,
    "",
    "admin-shift",
    "admin-shift:",
    "admin-shift:has space",
    "admin-shift:a/b",
    "admin-shift:a:b",
    `admin-shift:${"x".repeat(65)}`,
    "admin-shifts:extra",
    "worker-bids:cmabc123",
    "clerk-shift:cmabc123",
    "ADMIN-SHIFT:cmabc123",
  ])("rejects %j", (raw) => {
    expect(parseLiveTopic(raw)).toBeNull();
  });
});

describe("liveTopicAccess - who may follow which topic kind", () => {
  const topics: LiveTopic[] = [
    { kind: "admin-shift", shiftId: "s1" },
    { kind: "admin-shifts" },
    { kind: "worker-shift", shiftId: "s1" },
    { kind: "worker-open-shifts" },
    { kind: "worker-bids" },
  ];

  const table: [string, Actor | null, Record<LiveTopic["kind"], boolean>][] = [
    [
      "ADMIN",
      admin,
      {
        "admin-shift": true,
        "admin-shifts": true,
        "worker-shift": false,
        "worker-open-shifts": false,
        "worker-bids": false,
      },
    ],
    [
      "STAFF",
      staff,
      {
        "admin-shift": false,
        "admin-shifts": false,
        "worker-shift": true,
        "worker-open-shifts": true,
        "worker-bids": true,
      },
    ],
    [
      "an unknown role",
      unknownRole,
      {
        "admin-shift": false,
        "admin-shifts": false,
        "worker-shift": false,
        "worker-open-shifts": false,
        "worker-bids": false,
      },
    ],
    [
      "no actor",
      null,
      {
        "admin-shift": false,
        "admin-shifts": false,
        "worker-shift": false,
        "worker-open-shifts": false,
        "worker-bids": false,
      },
    ],
  ];

  for (const [label, actor, expected] of table) {
    for (const topic of topics) {
      const allowed = expected[topic.kind];
      it(`${label} ${allowed ? "may" : "may NOT"} follow ${topic.kind}`, () => {
        expect(liveTopicAccess(actor, topic).allowed).toBe(allowed);
      });
    }
  }

  it("a STAFF actor asking for admin-shift is refused before any shift lookup", () => {
    // No shiftWhere to run means the route answers 403 without touching the
    // DB, so a refused caller learns nothing about whether the shift exists.
    expect(liveTopicAccess(staff, { kind: "admin-shift", shiftId: "s1" })).toEqual({
      allowed: false,
    });
  });
});

describe("liveTopicAccess - shift scope", () => {
  const dataset: FakeShift[] = [
    { id: "open", departmentId: "ER", status: "OPEN", assignedWorkerId: null, bids: [] },
    { id: "mine", departmentId: "ER", status: "ASSIGNED", assignedWorkerId: "w1", bids: [] },
    { id: "bid-on", departmentId: "ER", status: "ASSIGNED", assignedWorkerId: "w2", bids: [{ workerId: "w1" }] },
    { id: "theirs", departmentId: "ER", status: "ASSIGNED", assignedWorkerId: "w2", bids: [{ workerId: "w2" }] },
    { id: "cancelled", departmentId: "ER", status: "CANCELLED", assignedWorkerId: null, bids: [] },
  ];

  function visible(actor: Actor, kind: "admin-shift" | "worker-shift", shiftId: string) {
    const access = liveTopicAccess(actor, { kind, shiftId });
    if (!access.allowed || !access.shiftWhere) return false;
    return query(dataset, access.shiftWhere).length === 1;
  }

  it("an ADMIN's admin-shift scope is exactly that shift, whatever its state", () => {
    for (const shift of dataset) {
      expect(visible(admin, "admin-shift", shift.id)).toBe(true);
    }
    expect(visible(admin, "admin-shift", "missing")).toBe(false);
  });

  it("a STAFF worker-shift is scoped by shiftReadScope", () => {
    expect(visible(staff, "worker-shift", "open")).toBe(true);
    expect(visible(staff, "worker-shift", "mine")).toBe(true);
    expect(visible(staff, "worker-shift", "bid-on")).toBe(true);
    // Someone else's assigned shift the worker never bid on: 404, not a revision.
    expect(visible(staff, "worker-shift", "theirs")).toBe(false);
    expect(visible(staff, "worker-shift", "cancelled")).toBe(false);
    expect(visible(staff, "worker-shift", "missing")).toBe(false);
  });

  it("list topics carry no shift scope", () => {
    expect(liveTopicAccess(admin, { kind: "admin-shifts" })).toEqual({ allowed: true, shiftWhere: null });
    expect(liveTopicAccess(staff, { kind: "worker-bids" })).toEqual({ allowed: true, shiftWhere: null });
  });
});
