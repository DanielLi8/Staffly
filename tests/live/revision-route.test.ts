import { describe, it, expect, vi, beforeEach } from "vitest";

const getSessionMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
  actorFromSession: (session: { user: { id: string; role: string } }) => ({
    id: session.user.id,
    role: session.user.role,
  }),
}));

const findFirstMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { shift: { findFirst: findFirstMock } } }));

const liveRevisionMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/live/revision", () => ({ liveRevision: liveRevisionMock }));

import { GET } from "@/app/api/live/revision/route";

/**
 * `/api/live/revision` sits outside the NextAuth middleware matcher, so it does
 * its own session + topic checks. Its 4xx answers are what make the client stop
 * polling, and a refused caller must learn nothing about a shift.
 */

const call = (topic: string | null) =>
  GET(new Request(`http://localhost/api/live/revision${topic === null ? "" : `?topic=${encodeURIComponent(topic)}`}`));

const signedIn = (role: "ADMIN" | "STAFF", id = "u1") =>
  getSessionMock.mockResolvedValue({ user: { id, role } });

beforeEach(() => {
  getSessionMock.mockReset();
  findFirstMock.mockReset();
  liveRevisionMock.mockReset();
});

describe("GET /api/live/revision", () => {
  it("401s without a session, before parsing anything", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await call("admin-shift:s1");
    expect(res.status).toBe(401);
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it.each([null, "", "nope", "admin-shift:", "admin-shift:a b"])("400s a malformed topic (%j)", async (topic) => {
    signedIn("ADMIN");
    expect((await call(topic)).status).toBe(400);
  });

  it("403s a STAFF actor asking for an admin topic without looking the shift up", async () => {
    signedIn("STAFF");
    const res = await call("admin-shift:s1");
    expect(res.status).toBe(403);
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(liveRevisionMock).not.toHaveBeenCalled();
  });

  it("403s an ADMIN asking for a worker topic", async () => {
    signedIn("ADMIN");
    expect((await call("worker-shift:s1")).status).toBe(403);
  });

  it("404s a shift that doesn't exist", async () => {
    signedIn("ADMIN");
    findFirstMock.mockResolvedValue(null);
    const res = await call("admin-shift:missing");
    expect(res.status).toBe(404);
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { AND: [{}, { id: "missing" }] },
      select: { id: true },
    });
    expect(liveRevisionMock).not.toHaveBeenCalled();
  });

  it("scopes a STAFF worker-shift lookup by shiftReadScope and 404s outside it", async () => {
    signedIn("STAFF", "w1");
    findFirstMock.mockResolvedValue(null);
    expect((await call("worker-shift:s1")).status).toBe(404);
    const where = findFirstMock.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"workerId":"w1"');
  });

  it("404s a topic with no revision source yet", async () => {
    signedIn("ADMIN");
    liveRevisionMock.mockResolvedValue(null);
    expect((await call("admin-shifts")).status).toBe(404);
  });

  it("returns the revision, uncacheable", async () => {
    signedIn("ADMIN");
    findFirstMock.mockResolvedValue({ id: "s1" });
    liveRevisionMock.mockResolvedValue("abc123");
    const res = await call("admin-shift:s1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revision: "abc123" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(liveRevisionMock).toHaveBeenCalledWith({ kind: "admin-shift", shiftId: "s1" });
  });

  it("marks refusals uncacheable too", async () => {
    getSessionMock.mockResolvedValue(null);
    expect((await call("admin-shift:s1")).headers.get("Cache-Control")).toBe("no-store");
  });
});
