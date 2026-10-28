import { describe, it, expect, vi, beforeEach } from "vitest";

const requireActorMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ requireActor: requireActorMock }));

const revalidatePathMock = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const store = vi.hoisted(() => ({
  saveWeeklyTargets: vi.fn(),
  setTargetOverride: vi.fn(),
  removeTargetOverride: vi.fn(),
  applySundayNumbers: vi.fn(),
  updateShiftTemplate: vi.fn(),
  setShiftPattern: vi.fn(),
}));
vi.mock("@/lib/staffing/store", () => store);

import {
  applySundayNumbers,
  removeTargetOverride,
  saveWeeklyTargets,
  setShiftPattern,
  setTargetOverride,
  updateShiftTemplate,
} from "@/app/actions/staffing-targets";

const ADMIN = { id: "admin-1", role: "ADMIN" };

const validWeekly = {
  departmentId: "dept-1",
  changes: [{ templateId: "tpl-d", role: "RN", days: ["MON", "TUE"], before: [4, 4], count: 5 }],
};
const validOverride = { templateId: "tpl-d", date: "2030-01-05", role: "RN", count: 6, reason: " Census ", expected: null };
const validTemplate = {
  templateId: "tpl-d",
  before: { startMinute: 420, endMinute: 900, leadRequired: true },
  after: { startMinute: 450, endMinute: 930, leadRequired: true },
};

const calls: [string, () => Promise<unknown>, ReturnType<typeof vi.fn>][] = [
  ["saveWeeklyTargets", () => saveWeeklyTargets(validWeekly), store.saveWeeklyTargets],
  ["setTargetOverride", () => setTargetOverride(validOverride), store.setTargetOverride],
  ["removeTargetOverride", () => removeTargetOverride({ overrideId: "o1" }), store.removeTargetOverride],
  ["applySundayNumbers", () => applySundayNumbers({ departmentId: "dept-1", date: "2030-12-25" }), store.applySundayNumbers],
  ["updateShiftTemplate", () => updateShiftTemplate(validTemplate), store.updateShiftTemplate],
  [
    "setShiftPattern",
    () => setShiftPattern({ departmentId: "dept-1", from: "EIGHT_HOUR", to: "TWELVE_HOUR" }),
    store.setShiftPattern,
  ],
];

beforeEach(() => {
  vi.clearAllMocks();
  requireActorMock.mockResolvedValue(ADMIN);
  for (const fn of Object.values(store)) fn.mockResolvedValue({ ok: true, message: "Saved." });
});

describe("staffing target actions: ADMIN only", () => {
  it.each(calls)("%s requires an ADMIN actor", async (_name, call) => {
    await call();
    expect(requireActorMock).toHaveBeenCalledWith("ADMIN");
  });

  it.each(calls)("%s rejects a non-admin and never writes", async (_name, call, storeFn) => {
    requireActorMock.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(call()).rejects.toThrow("FORBIDDEN");
    expect(storeFn).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it.each(calls)("%s writes as the signed-in admin and revalidates on success", async (_name, call, storeFn) => {
    await expect(call()).resolves.toEqual({ ok: true, message: "Saved." });
    expect(storeFn).toHaveBeenCalledWith("admin-1", expect.any(Object));
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/departments/[id]/targets", "page");
  });
});

describe("staffing target actions: typed failures, never throws", () => {
  it.each([
    ["a negative count", { ...validWeekly, changes: [{ ...validWeekly.changes[0], count: -1 }] }, "A target can't be below 0."],
    ["a fractional count", { ...validWeekly, changes: [{ ...validWeekly.changes[0], count: 2.5 }] }, "Enter a whole number."],
    ["a count over 99", { ...validWeekly, changes: [{ ...validWeekly.changes[0], count: 100 }] }, "A target can't be above 99."],
    ["an unknown role", { ...validWeekly, changes: [{ ...validWeekly.changes[0], role: "CNA" }] }, undefined],
    ["mismatched before/days", { ...validWeekly, changes: [{ ...validWeekly.changes[0], before: [4] }] }, "Bad change."],
    ["no changes", { ...validWeekly, changes: [] }, "Nothing to save."],
  ])("saveWeeklyTargets returns INVALID for %s", async (_label, input, message) => {
    const result = await saveWeeklyTargets(input);
    expect(result).toMatchObject({ ok: false, reason: "INVALID" });
    if (message) expect(result).toMatchObject({ message });
    expect(store.saveWeeklyTargets).not.toHaveBeenCalled();
  });

  it("setTargetOverride returns INVALID for an impossible date and trims the reason it passes on", async () => {
    expect(await setTargetOverride({ ...validOverride, date: "2030-02-30" })).toMatchObject({
      ok: false,
      reason: "INVALID",
      message: "Pick a valid date.",
    });
    expect(store.setTargetOverride).not.toHaveBeenCalled();

    await setTargetOverride(validOverride);
    expect(store.setTargetOverride).toHaveBeenCalledWith("admin-1", expect.objectContaining({ reason: "Census" }));
    await setTargetOverride({ ...validOverride, reason: "   " });
    expect(store.setTargetOverride).toHaveBeenLastCalledWith("admin-1", expect.objectContaining({ reason: null }));
  });

  it("setTargetOverride returns INVALID for an overlong reason", async () => {
    const result = await setTargetOverride({ ...validOverride, reason: "x".repeat(201) });
    expect(result).toMatchObject({ ok: false, reason: "INVALID" });
  });

  it("updateShiftTemplate refuses a zero-length or off-grid shift", async () => {
    expect(
      await updateShiftTemplate({ ...validTemplate, after: { ...validTemplate.after, endMinute: 450 } })
    ).toEqual({ ok: false, reason: "INVALID", message: "A shift can't start and end at the same time." });
    expect(
      await updateShiftTemplate({ ...validTemplate, after: { ...validTemplate.after, startMinute: 455 } })
    ).toMatchObject({ ok: false, reason: "INVALID" });
    expect(store.updateShiftTemplate).not.toHaveBeenCalled();
  });

  it("setShiftPattern returns INVALID for an unknown pattern", async () => {
    expect(await setShiftPattern({ departmentId: "d", from: "EIGHT_HOUR", to: "TEN_HOUR" })).toMatchObject({
      ok: false,
      reason: "INVALID",
    });
  });

  it("passes the store's typed failure through without revalidating", async () => {
    store.saveWeeklyTargets.mockResolvedValue({ ok: false, reason: "STALE", message: "Someone else changed these numbers." });
    expect(await saveWeeklyTargets(validWeekly)).toEqual({
      ok: false,
      reason: "STALE",
      message: "Someone else changed these numbers.",
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
