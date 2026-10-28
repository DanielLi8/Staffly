import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { Role } from "@prisma/client";
import {
  CAPABILITIES,
  UNGATED_ENTRY_POINTS,
  can,
  type Capability,
  type CapabilityRow,
} from "@/lib/authz/capabilities";
import { LIVE_TOPIC_CAPABILITY, type LiveTopicKind } from "@/lib/live/topics";

/**
 * Every exported server action and route handler, checked against the
 * permission matrix (`src/lib/authz/capabilities.ts`).
 *
 * 1. Discovery: every `"use server"` module and every `route.ts` under `src`
 *    is found on disk, and each export must be registered exactly once - in a
 *    row's `enforcedAt` or in `UNGATED_ENTRY_POINTS`. A new action with no row
 *    fails here.
 * 2. Enforcement: each capability-gated entry point is called as anonymous and
 *    as every value of `enum Role`, with the database replaced by a tripwire.
 *    Allowed callers must get past the gate; everyone else must be refused
 *    (UNAUTHORIZED/FORBIDDEN, or 401/403) before anything is read - so the gate
 *    has to come first, ahead of input parsing. A role added to the enum is
 *    covered automatically.
 */

const ROOT = resolve(__dirname, "../..");

const t = vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET ??= "entry-points-test-secret";
  class DbReached extends Error {
    constructor() {
      super("DB_REACHED");
    }
  }
  return { session: null as null | { user: { id: string; role: string; name: string; email: string } }, DbReached };
});

vi.mock("next-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth")>()),
  getServerSession: async () => t.session,
}));

vi.mock("@/lib/db", () => {
  const trip = () => {
    throw new t.DbReached();
  };
  const model = new Proxy({}, { get: () => trip });
  return {
    db: new Proxy({}, { get: (_target, key) => (key === "then" ? undefined : String(key).startsWith("$") ? trip : model) }),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => {} }),
  headers: () => new Headers(),
}));

/* ------------------------------------------------------------- discovery */

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const sourceFiles = walk(join(ROOT, "src"));
const rel = (path: string) => relative(ROOT, path).split("\\").join("/");

const isServerModule = (source: string) => /^\s*(?:\/\/[^\n]*\n\s*)*["']use server["']/.test(source);
const actionFiles = sourceFiles.filter((f) => isServerModule(readFileSync(f, "utf8")));
const inlineServerActionFiles = sourceFiles.filter((f) => {
  const source = readFileSync(f, "utf8");
  return !isServerModule(source) && /["']use server["']/.test(source);
});
const routeFiles = sourceFiles.filter((f) => /\/route\.ts$/.test(f) && rel(f).startsWith("src/app/"));

interface EntryPoint {
  id: string;
  kind: "action" | "route";
  fn: (...args: unknown[]) => unknown;
}

async function discover(): Promise<EntryPoint[]> {
  const found: EntryPoint[] = [];
  for (const file of actionFiles) {
    const mod: Record<string, unknown> = await import(file);
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === "function") {
        found.push({ id: `${rel(file)}#${name}`, kind: "action", fn: value as EntryPoint["fn"] });
      }
    }
  }
  for (const file of routeFiles) {
    const mod: Record<string, unknown> = await import(file);
    for (const [name, value] of Object.entries(mod)) {
      if (HTTP_METHODS.has(name) && typeof value === "function") {
        found.push({ id: `${rel(file)}#${name}`, kind: "route", fn: value as EntryPoint["fn"] });
      }
    }
  }
  return found;
}

/* -------------------------------------------------------------- registry */

const ENTRY_ID = /^src\/.+#\w+$/;
const rows = Object.entries(CAPABILITIES) as [Capability, CapabilityRow][];

const gatedBy = new Map<string, Capability[]>();
for (const [capability, row] of rows) {
  for (const ref of row.enforcedAt ?? []) {
    if (ENTRY_ID.test(ref)) gatedBy.set(ref, [...(gatedBy.get(ref) ?? []), capability]);
  }
}
const ungated = new Set(Object.keys(UNGATED_ENTRY_POINTS));

/* --------------------------------------------------------------- calling */

type Caller = { label: string; role: Role | null };
const callers: Caller[] = [{ label: "anonymous", role: null }, ...Object.values(Role).map((role) => ({ label: role, role }))];

function signIn(role: Role | null) {
  t.session = role ? { user: { id: `user-${role}`, role, name: "Test User", email: "t@example.com" } } : null;
}

/** Arguments for an entry point whose code touches its input before the gate can run. */
const ARGS: Record<string, unknown[]> = {
  "src/app/(dashboard)/admin/workers/toggle-team-lead-action.ts#toggleTeamLeadFormAction": [new FormData()],
};

function requestFor(id: string): Request {
  const method = id.slice(id.indexOf("#") + 1);
  return new Request("http://localhost/entry-point-test", {
    method,
    ...(method === "GET" || method === "HEAD" ? {} : { body: JSON.stringify({ ids: [] }) }),
  });
}

const isDenial = (err: unknown) =>
  err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "FORBIDDEN");

/** "denied" when refused at the gate, "allowed" for anything past it. */
async function attempt(entry: EntryPoint): Promise<"allowed" | "denied"> {
  try {
    const result = entry.kind === "route" ? await entry.fn(requestFor(entry.id)) : await entry.fn(...(ARGS[entry.id] ?? []));
    if (result instanceof Response && (result.status === 401 || result.status === 403)) return "denied";
    return "allowed";
  } catch (err) {
    return isDenial(err) ? "denied" : "allowed";
  }
}

/* ----------------------------------------------------------------- tests */

const discovered = discover();
async function entryPoints() {
  const entries = await discovered;
  return { entries, byId: new Map(entries.map((e) => [e.id, e])) };
}
const gatedEntries = Array.from(gatedBy.entries());

beforeEach(() => signIn(null));

describe("entry-point discovery", () => {
  it("finds the server actions and route handlers", async () => {
    const { entries } = await entryPoints();
    expect(actionFiles.length).toBeGreaterThan(5);
    expect(routeFiles.length).toBeGreaterThan(5);
    expect(entries.length).toBeGreaterThan(30);
  });

  it("has no inline server actions (they would escape this table)", () => {
    expect(inlineServerActionFiles.map(rel)).toEqual([]);
  });

  it("every exported server action and route handler has a matrix row", async () => {
    const { entries } = await entryPoints();
    const missing = entries.map((e) => e.id).filter((id) => !gatedBy.has(id) && !ungated.has(id));
    expect(missing, "add each to a row's enforcedAt in src/lib/authz/capabilities.ts").toEqual([]);
  });

  it("registers each entry point exactly once", () => {
    const twice = gatedEntries.filter(([id, caps]) => caps.length > 1 || ungated.has(id)).map(([id]) => id);
    expect(twice).toEqual([]);
  });

  it("names no entry point that does not exist", async () => {
    const { byId } = await entryPoints();
    const stale = gatedEntries.map(([id]) => id).concat(Array.from(ungated)).filter((id) => !byId.has(id));
    expect(stale).toEqual([]);
  });

  it("gates code only on active rows", () => {
    const planned = gatedEntries.filter(([, caps]) => caps.some((c) => CAPABILITIES[c].status !== "active"));
    expect(planned).toEqual([]);
  });
});

const gatedCases = gatedEntries.flatMap(([id, [capability]]) =>
  callers.map((caller) => ({
    id,
    capability,
    caller: caller.label,
    role: caller.role,
    expected: caller.role !== null && can({ id: `user-${caller.role}`, role: caller.role }, capability) ? "allowed" : "denied",
  }))
);

describe("every gated entry point enforces its matrix row", () => {
  it.each(gatedCases)("$id ($capability) as $caller: $expected", async ({ id, role, expected }) => {
    const { byId } = await entryPoints();
    const entry = byId.get(id);
    expect(entry, `${id} not found`).toBeDefined();
    signIn(role);
    expect(await attempt(entry!)).toBe(expected);
  });
});

describe("ungated entry points", () => {
  it("phoneVerificationAvailable answers anyone (it reveals only whether Verify is configured)", async () => {
    const { byId } = await entryPoints();
    const entry = byId.get("src/app/actions/profile.ts#phoneVerificationAvailable")!;
    expect(await attempt(entry)).toBe("allowed");
  });

  it.each(
    Object.entries(UNGATED_ENTRY_POINTS)
      .filter(([, v]) => v.gate === "twilio-signature")
      .map(([id]) => id)
  )("%s refuses an unsigned request before reading anything", async (id) => {
    const { byId } = await entryPoints();
    const res = (await byId.get(id)!.fn(new Request("http://localhost/webhook", { method: "POST" }))) as Response;
    expect(res.status).toBe(403);
  });

  const liveRoute = "src/app/api/live/revision/route.ts#GET";
  const topics: [LiveTopicKind, string][] = [
    ["admin-shift", "admin-shift:s1"],
    ["admin-shifts", "admin-shifts"],
    ["worker-shift", "worker-shift:s1"],
    ["worker-open-shifts", "worker-open-shifts"],
    ["worker-bids", "worker-bids"],
  ];
  const liveCases = topics.flatMap(([kind, raw]) =>
    callers.map((caller) => ({
      kind,
      raw,
      caller: caller.label,
      role: caller.role,
      capability: LIVE_TOPIC_CAPABILITY[kind],
      expected:
        caller.role !== null && can({ id: "u", role: caller.role }, LIVE_TOPIC_CAPABILITY[kind]) ? "allowed" : "denied",
    }))
  );

  it.each(liveCases)("live topic $kind ($capability) as $caller: $expected", async ({ raw, role, expected }) => {
    signIn(role);
    const { byId } = await entryPoints();
    const entry = byId.get(liveRoute)!;
    let outcome: "allowed" | "denied";
    try {
      const res = (await entry.fn(new Request(`http://localhost/api/live/revision?topic=${encodeURIComponent(raw)}`))) as Response;
      outcome = res.status === 401 || res.status === 403 ? "denied" : "allowed";
    } catch (err) {
      outcome = isDenial(err) ? "denied" : "allowed";
    }
    expect(outcome).toBe(expected);
  });
});
