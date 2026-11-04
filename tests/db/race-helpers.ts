/**
 * Shared harness for the real-Postgres race tests (tests/db/*.race.db.test.ts).
 *
 * The server actions are called directly, exactly as Next.js would, against
 * the real database. Only two things are stubbed, both outside the code under
 * test: the session (`@/lib/auth`, so each concurrent call can run as a
 * different signed-in user) and `next/cache` (no Next.js request context).
 *
 * Usage in a test file:
 *   vi.mock("@/lib/auth", async () => (await import("./race-helpers")).authModuleMock);
 *   vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
 *
 * Fixtures are created per file under a unique tag (their own department,
 * admins and workers with a position nobody else has, so the callout cascade
 * only ever reaches them) and removed by `cleanup`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Role, User } from "@prisma/client";
import { db } from "@/lib/db";

const currentUser = new AsyncLocalStorage<{ id: string; role: Role }>();

/** Run `fn` signed in as `user`. Concurrent calls each keep their own user. */
export function as<T>(user: { id: string; role: Role }, fn: () => Promise<T>): Promise<T> {
  return currentUser.run({ id: user.id, role: user.role }, fn);
}

async function requireAuth(role?: Role) {
  const user = currentUser.getStore();
  if (!user) throw new Error("UNAUTHORIZED");
  if (role && user.role !== role) throw new Error("FORBIDDEN");
  return { user: { ...user, name: null, email: null }, expires: "" };
}

export const authModuleMock = {
  requireAuth,
  getSession: async () => {
    const user = currentUser.getStore();
    return user ? { user, expires: "" } : null;
  },
  requireActor: async (role?: Role) => {
    const session = await requireAuth(role);
    return { id: session.user.id, role: session.user.role };
  },
  actorFromSession: (session: { user: { id: string; role: Role } }) => ({
    id: session.user.id,
    role: session.user.role,
  }),
};

const HOUR = 60 * 60 * 1000;

export interface RaceFixtures {
  tag: string;
  position: string;
  departmentId: string;
  /** Two admins: the two people racing each other. */
  sarah: User;
  james: User;
  /** Workers in the fixture department, all matching the fixture position. */
  workers: User[];
}

export async function createFixtures(tag: string, workerCount = 3): Promise<RaceFixtures> {
  const stamp = `${tag}-${Date.now()}`;
  const position = `Race Nurse ${stamp}`;
  const department = await db.department.create({
    data: { name: `Race ${stamp}`, code: `R-${stamp}` },
  });
  const mk = (role: Role, name: string, i: number) =>
    db.user.create({
      data: {
        name,
        email: `race-${stamp}-${role.toLowerCase()}-${i}@test.invalid`,
        password: "not-a-real-hash",
        role,
        position: role === "STAFF" ? position : "Staffing Coordinator",
        seniorityRank: i,
      },
    });
  const sarah = await mk("ADMIN", "Sarah Race", 0);
  const james = await mk("ADMIN", "James Race", 1);
  const workers: User[] = [];
  for (let i = 0; i < workerCount; i++) {
    const w = await mk("STAFF", `Worker ${String.fromCharCode(65 + i)} Race`, i + 1);
    await db.departmentMembership.create({
      data: { departmentId: department.id, userId: w.id, title: "RN" },
    });
    workers.push(w);
  }
  return { tag: stamp, position, departmentId: department.id, sarah, james, workers };
}

/** A shift in the fixture department, starting `hoursAhead` from now. */
export async function createShift(
  f: RaceFixtures,
  data: { status?: "OPEN" | "ASSIGNED"; assignedWorkerId?: string; hoursAhead?: number } = {}
) {
  const startsAt = new Date(Date.now() + (data.hoursAhead ?? 30) * HOUR);
  return db.shift.create({
    data: {
      title: `Race shift ${f.tag}`,
      unit: "R1",
      departmentId: f.departmentId,
      roleNeeded: f.position,
      location: `race-${f.tag}`,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 12 * HOUR),
      status: data.status ?? "OPEN",
      assignedWorkerId: data.assignedWorkerId,
      createdById: f.sarah.id,
    },
  });
}

/** Remove everything the fixtures created, in FK order. */
export async function cleanup(f: RaceFixtures | undefined): Promise<void> {
  if (!f) return;
  const userIds = [f.sarah.id, f.james.id, ...f.workers.map((w) => w.id)];
  const shifts = await db.shift.findMany({ where: { departmentId: f.departmentId }, select: { id: true } });
  const shiftIds = shifts.map((s) => s.id);
  await db.notification.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { shiftId: { in: shiftIds } }] } });
  await db.shiftSwapRequest.deleteMany({
    where: { OR: [{ requesterId: { in: userIds } }, { targetUserId: { in: userIds } }] },
  });
  await db.shift.deleteMany({ where: { id: { in: shiftIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.department.delete({ where: { id: f.departmentId } });
}

/** How many of a set of results succeeded. */
export function wins(results: { ok: boolean }[]): number {
  return results.filter((r) => r.ok).length;
}

/**
 * Each race runs this many times: interleavings vary run to run, and a broken
 * guard only has to lose once to fail the test.
 */
export const ROUNDS = 8;
