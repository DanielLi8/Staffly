import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * The Staff page's server actions against a mocked Prisma client: who may call
 * them (authz) and the typed failures they return instead of throwing.
 */

const db = vi.hoisted(() => {
  const fn = () => vi.fn();
  const client = {
    user: { findUnique: fn(), findFirst: fn(), create: fn(), update: fn(), updateMany: fn() },
    department: { count: fn(), findUnique: fn(), findFirst: fn(), create: fn(), update: fn(), aggregate: fn() },
    departmentMembership: { deleteMany: fn(), upsert: fn() },
    shift: { findMany: fn() },
    shiftBid: { deleteMany: fn() },
    shiftSwapRequest: { updateMany: fn() },
    auditLog: { create: fn() },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation((work: (tx: typeof client) => unknown) => work(client));
  return client;
});
vi.mock("@/lib/db", () => ({ db }));

const requireAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ requireAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createStaffMember,
  deactivateStaffMember,
  reactivateStaffMember,
  updateStaffMember,
} from "@/app/actions/staff";
import { createDepartment, updateDepartment } from "@/app/actions/departments";
import { STAFF_MESSAGES, type StaffFormInput } from "@/lib/staff/validation";
import { DEPARTMENT_MESSAGES } from "@/lib/departments/validation";

const MANAGER = { user: { id: "admin-sys", role: "ADMIN", email: "sys@staffly.com", name: "Kevin" } };
const ADMIN = { user: { id: "admin-2", role: "ADMIN", email: "sarah@staffly.com", name: "Sarah" } };

function form(overrides: Partial<StaffFormInput> = {}): StaffFormInput {
  return {
    name: "Jordan Lee",
    email: "jordan.lee@hospital.ca",
    employeeId: "",
    position: "Personal Support Worker",
    primaryDepartmentId: "",
    hireDate: "2026-11-02",
    seniorityRank: "",
    phone: "",
    phoneConfirmed: false,
    isTeamLead: false,
    memberships: [{ departmentId: "dept-er", title: "PSW" }],
    ...overrides,
  };
}

function uniqueError(target: string) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "5.22.0",
    meta: { target: [target] },
  });
}

function resetDb() {
  for (const model of Object.values(db)) {
    if (typeof model === "function") continue;
    for (const method of Object.values(model)) (method as ReturnType<typeof vi.fn>).mockReset();
  }
  // Defaults: every referenced department exists, nothing is taken.
  db.department.count.mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
    Promise.resolve(where.id.in.length)
  );
  db.department.findUnique.mockResolvedValue({ name: "Emergency Department", hospitalId: "h1" });
  db.user.findFirst.mockResolvedValue(null);
  db.auditLog.create.mockResolvedValue({});
}

beforeEach(() => {
  resetDb();
  requireAuth.mockReset();
  process.env.STAFF_ACCOUNT_MANAGERS = "sys@staffly.com";
});
afterEach(() => {
  delete process.env.STAFF_ACCOUNT_MANAGERS;
});

describe("createStaffMember", () => {
  it("propagates a non-ADMIN rejection and writes nothing", async () => {
    requireAuth.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(createStaffMember(form())).rejects.toThrow("FORBIDDEN");
    expect(requireAuth).toHaveBeenCalledWith("ADMIN");
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it("refuses an ADMIN who isn't a staff account manager", async () => {
    requireAuth.mockResolvedValue(ADMIN);
    await expect(createStaffMember(form())).rejects.toThrow("FORBIDDEN");
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it("refuses everyone when STAFF_ACCOUNT_MANAGERS is unset", async () => {
    delete process.env.STAFF_ACCOUNT_MANAGERS;
    requireAuth.mockResolvedValue(MANAGER);
    await expect(createStaffMember(form())).rejects.toThrow("FORBIDDEN");
  });

  it("returns field errors for invalid input without touching the DB", async () => {
    requireAuth.mockResolvedValue(MANAGER);
    const result = await createStaffMember(form({ position: "Nurse", email: "" }));
    expect(result).toEqual({
      ok: false,
      fieldErrors: { email: STAFF_MESSAGES.emailRequired, position: STAFF_MESSAGES.positionRequired },
    });
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns a typed failure for a malformed payload", async () => {
    requireAuth.mockResolvedValue(MANAGER);
    const result = await createStaffMember({ name: 42 });
    expect(result).toMatchObject({ ok: false, formError: expect.any(String) });
  });

  it("reports a taken email, an unknown department and a verified number in use", async () => {
    requireAuth.mockResolvedValue(MANAGER);
    db.user.findUnique.mockResolvedValueOnce({ id: "someone" });
    db.department.count.mockResolvedValue(0);
    db.user.findFirst.mockResolvedValue({ id: "other" });
    const result = await createStaffMember(form({ phone: "+14165550101", phoneConfirmed: true }));
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        email: STAFF_MESSAGES.emailTaken,
        memberships: STAFF_MESSAGES.membershipUnknownDepartment,
        phone: STAFF_MESSAGES.phoneTaken,
      },
    });
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it("creates a password-less STAFF account with memberships and an audit row", async () => {
    requireAuth.mockResolvedValue(MANAGER);
    db.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ hospitalId: "h1" });
    db.user.create.mockResolvedValue({ id: "new-user" });

    const result = await createStaffMember(form({ phone: "+14165550199", phoneConfirmed: true }));

    expect(result).toEqual({ ok: true, id: "new-user" });
    const data = db.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      name: "Jordan Lee",
      email: "jordan.lee@hospital.ca",
      password: null,
      role: "STAFF",
      position: "Personal Support Worker",
      department: "Emergency Department",
      hireDate: new Date(Date.UTC(2026, 10, 2)),
      phone: "+14165550199",
      hospitalId: "h1",
      departmentMemberships: { create: [{ departmentId: "dept-er", title: "PSW" }] },
    });
    expect(data.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({
      actorId: "admin-sys",
      action: "STAFF_CREATED",
      targetType: "User",
      targetId: "new-user",
    });
  });

  it("maps a lost unique race back onto the email field", async () => {
    requireAuth.mockResolvedValue(MANAGER);
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockRejectedValue(uniqueError("email"));
    expect(await createStaffMember(form())).toEqual({ ok: false, fieldErrors: { email: STAFF_MESSAGES.emailTaken } });
  });
});

describe("updateStaffMember", () => {
  const existing = {
    role: "STAFF",
    hospitalId: "h1",
    phone: "+14165550101",
    phoneVerifiedAt: new Date("2026-07-01T00:00:00Z"),
    departmentMemberships: [
      { departmentId: "dept-er", title: "RN" },
      { departmentId: "dept-icu", title: "RN" },
    ],
  };

  it("is open to any ADMIN, not only staff account managers", async () => {
    requireAuth.mockResolvedValue(ADMIN);
    db.user.findUnique.mockResolvedValue(existing);
    const result = await updateStaffMember("u1", form({ phone: "+14165550101", phoneConfirmed: true }));
    expect(result).toEqual({ ok: true, id: "u1" });
  });

  it("propagates a non-ADMIN rejection", async () => {
    requireAuth.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(updateStaffMember("u1", form())).rejects.toThrow("FORBIDDEN");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND-style failure for a missing or non-STAFF target", async () => {
    requireAuth.mockResolvedValue(ADMIN);
    db.user.findUnique.mockResolvedValue({ ...existing, role: "ADMIN" });
    const result = await updateStaffMember("u1", form());
    expect(result).toMatchObject({ ok: false, formError: "This staff member no longer exists." });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("refuses an employee ID someone else has", async () => {
    requireAuth.mockResolvedValue(ADMIN);
    db.user.findUnique.mockResolvedValue(existing);
    db.user.findFirst.mockResolvedValue({ id: "other" });
    const result = await updateStaffMember("u1", form({ employeeId: "E-1" }));
    expect(result).toEqual({ ok: false, fieldErrors: { employeeId: STAFF_MESSAGES.employeeIdTaken } });
    expect(db.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employeeId: "E-1", id: { not: "u1" } } })
    );
  });

  it("replaces memberships, keeps an unchanged verified phone and audits the change", async () => {
    requireAuth.mockResolvedValue(ADMIN);
    db.user.findUnique.mockResolvedValue(existing);

    const result = await updateStaffMember(
      "u1",
      form({
        position: "Registered Practical Nurse",
        phone: "+14165550101",
        phoneConfirmed: true,
        memberships: [
          { departmentId: "dept-er", title: "Charge RPN" },
          { departmentId: "dept-med", title: "Float RPN" },
        ],
      })
    );

    expect(result).toEqual({ ok: true, id: "u1" });
    expect(db.user.update.mock.calls[0][0].data).toMatchObject({
      position: "Registered Practical Nurse",
      phoneVerifiedAt: existing.phoneVerifiedAt,
    });
    expect(db.departmentMembership.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", departmentId: { in: ["dept-icu"] } },
    });
    expect(db.departmentMembership.upsert).toHaveBeenCalledTimes(2);
    expect(db.departmentMembership.upsert.mock.calls[1][0]).toMatchObject({
      where: { departmentId_userId: { departmentId: "dept-med", userId: "u1" } },
      create: { departmentId: "dept-med", userId: "u1", title: "Float RPN" },
    });
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "STAFF_UPDATED", targetId: "u1" });
  });

  it("un-verifies a new number the admin didn't confirm", async () => {
    requireAuth.mockResolvedValue(ADMIN);
    db.user.findUnique.mockResolvedValue(existing);
    await updateStaffMember("u1", form({ phone: "+14165550999", phoneConfirmed: false }));
    expect(db.user.update.mock.calls[0][0].data).toMatchObject({ phone: "+14165550999", phoneVerifiedAt: null });
  });
});

describe("deactivateStaffMember", () => {
  const target = { role: "STAFF", hospitalId: "h1" };

  it("refuses an ADMIN who isn't a staff account manager", async () => {
    requireAuth.mockResolvedValue(ADMIN);
    await expect(deactivateStaffMember({ userId: "u1", reason: "Resigned" })).rejects.toThrow("FORBIDDEN");
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an unknown reason", async () => {
    requireAuth.mockResolvedValue(MANAGER);
    expect(await deactivateStaffMember({ userId: "u1", reason: "Vibes" })).toEqual({
      ok: false,
      reason: "INVALID_REASON",
    });
  });

  it("returns NOT_FOUND for a non-STAFF account", async () => {
    requireAuth.mockResolvedValue(MANAGER);
    db.user.findUnique.mockResolvedValue({ role: "ADMIN", hospitalId: "h1" });
    expect(await deactivateStaffMember({ userId: "u1", reason: "Resigned" })).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
  });

  it("is refused while they hold upcoming assigned shifts, listing them", async () => {
    requireAuth.mockResolvedValue(MANAGER);
    db.user.findUnique.mockResolvedValue(target);
    const startsAt = new Date(Date.now() + 86_400_000);
    const endsAt = new Date(startsAt.getTime() + 8 * 3_600_000);
    db.shift.findMany.mockResolvedValue([{ id: "s1", startsAt, endsAt, department: { name: "ICU" } }]);

    const result = await deactivateStaffMember({ userId: "u1", reason: "Resigned" });

    expect(result).toEqual({
      ok: false,
      reason: "HAS_UPCOMING_SHIFTS",
      shifts: [{ id: "s1", startsAt, endsAt, departmentName: "ICU" }],
    });
    expect(db.shift.findMany.mock.calls[0][0].where).toMatchObject({
      assignedWorkerId: "u1",
      status: "ASSIGNED",
      endsAt: { gt: expect.any(Date) },
    });
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });

  it("reports ALREADY_DEACTIVATED when the conditional update loses", async () => {
    requireAuth.mockResolvedValue(MANAGER);
    db.user.findUnique.mockResolvedValue(target);
    db.shift.findMany.mockResolvedValue([]);
    db.user.updateMany.mockResolvedValue({ count: 0 });
    expect(await deactivateStaffMember({ userId: "u1", reason: "Resigned" })).toEqual({
      ok: false,
      reason: "ALREADY_DEACTIVATED",
    });
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("deactivates, withdraws pending bids, cancels open swaps and audits", async () => {
    requireAuth.mockResolvedValue(MANAGER);
    db.user.findUnique.mockResolvedValue(target);
    db.shift.findMany.mockResolvedValue([]);
    db.user.updateMany.mockResolvedValue({ count: 1 });
    db.shiftBid.deleteMany.mockResolvedValue({ count: 2 });
    db.shiftSwapRequest.updateMany.mockResolvedValue({ count: 1 });

    const result = await deactivateStaffMember({ userId: "u1", reason: "End of contract" });

    expect(result).toEqual({ ok: true, bidsWithdrawn: 2, swapRequestsCancelled: 1 });
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", deactivatedAt: null },
      data: { deactivatedAt: expect.any(Date), deactivationReason: "End of contract" },
    });
    expect(db.shiftBid.deleteMany).toHaveBeenCalledWith({ where: { workerId: "u1", status: "PENDING" } });
    expect(db.shiftSwapRequest.updateMany.mock.calls[0][0]).toMatchObject({
      where: {
        OR: [{ requesterId: "u1" }, { targetUserId: "u1" }],
        status: { in: ["PENDING_ACCEPT", "ACCEPTED", "PENDING_APPROVAL"] },
      },
      data: { status: "CANCELLED" },
    });
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: "STAFF_DEACTIVATED",
      metadata: { reason: "End of contract", bidsWithdrawn: 2, swapRequestsCancelled: 1 },
    });
  });
});

describe("reactivateStaffMember", () => {
  it("refuses an ADMIN who isn't a staff account manager", async () => {
    requireAuth.mockResolvedValue(ADMIN);
    await expect(reactivateStaffMember("u1")).rejects.toThrow("FORBIDDEN");
  });

  it("returns NOT_DEACTIVATED for an active account", async () => {
    requireAuth.mockResolvedValue(MANAGER);
    db.user.findUnique.mockResolvedValue({ role: "STAFF", hospitalId: "h1" });
    db.user.updateMany.mockResolvedValue({ count: 0 });
    expect(await reactivateStaffMember("u1")).toEqual({ ok: false, reason: "NOT_DEACTIVATED" });
  });

  it("clears the deactivation and audits it", async () => {
    requireAuth.mockResolvedValue(MANAGER);
    db.user.findUnique.mockResolvedValue({ role: "STAFF", hospitalId: "h1" });
    db.user.updateMany.mockResolvedValue({ count: 1 });
    expect(await reactivateStaffMember("u1")).toEqual({ ok: true });
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", deactivatedAt: { not: null } },
      data: { deactivatedAt: null, deactivationReason: null },
    });
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "STAFF_REACTIVATED" });
  });
});

describe("department actions", () => {
  const dept = { name: "Oncology", code: "onc", wing: "", iconKey: "heart" };

  it("propagate a non-ADMIN rejection", async () => {
    requireAuth.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(createDepartment(dept)).rejects.toThrow("FORBIDDEN");
    await expect(updateDepartment("d1", dept)).rejects.toThrow("FORBIDDEN");
    expect(db.department.create).not.toHaveBeenCalled();
  });

  it("refuses a code another department has", async () => {
    requireAuth.mockResolvedValue(ADMIN);
    db.department.findUnique.mockResolvedValue({ id: "d-other" });
    expect(await createDepartment(dept)).toEqual({ ok: false, fieldErrors: { code: DEPARTMENT_MESSAGES.codeTaken } });
  });

  it("creates at the end of the list and audits it", async () => {
    requireAuth.mockResolvedValue(ADMIN);
    db.department.findUnique.mockResolvedValue(null);
    db.user.findUnique.mockResolvedValue({ hospitalId: "h1" });
    db.department.aggregate.mockResolvedValue({ _max: { sortOrder: 6 } });
    db.department.create.mockResolvedValue({ id: "d-new" });

    expect(await createDepartment(dept)).toEqual({ ok: true, id: "d-new" });
    expect(db.department.create.mock.calls[0][0].data).toEqual({
      name: "Oncology",
      code: "ONC",
      wing: null,
      iconKey: "heart",
      sortOrder: 7,
      hospitalId: "h1",
    });
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "DEPARTMENT_CREATED", targetId: "d-new" });
  });

  it("returns a typed failure for a department that no longer exists", async () => {
    requireAuth.mockResolvedValue(ADMIN);
    db.department.findUnique.mockResolvedValue(null);
    expect(await updateDepartment("gone", dept)).toMatchObject({
      ok: false,
      formError: "This department no longer exists.",
    });
  });

  it("maps a lost code race to the code field", async () => {
    requireAuth.mockResolvedValue(ADMIN);
    db.department.findUnique.mockResolvedValue({ hospitalId: "h1" });
    db.department.findFirst.mockResolvedValue(null);
    db.department.update.mockRejectedValue(uniqueError("code"));
    expect(await updateDepartment("d1", dept)).toEqual({
      ok: false,
      fieldErrors: { code: DEPARTMENT_MESSAGES.codeTaken },
    });
  });
});
