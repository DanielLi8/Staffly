import type { Prisma } from "@prisma/client";
import { shiftListWhere, type Actor } from "@/lib/authz";

/**
 * Live-update topics: what a page polls `/api/live/revision?topic=...` for so
 * it can `router.refresh()` when the data behind it changes. Pure (no DB, no
 * session), like the rest of the authorization layer, so the access table is
 * unit-testable.
 *
 * A topic names a slice of data, and its revision (src/lib/live/revision.ts)
 * is derived from exactly that slice. The access rule is per topic KIND:
 *
 * - `admin-*` topics are ADMIN-only. They may reflect every bid on a shift.
 * - `worker-*` topics are STAFF-only, and a shift-scoped one is further
 *   limited by {@link shiftListWhere} - the same read boundary every worker
 *   shift query goes through. Their revisions must never include other
 *   workers' bids: even an opaque string would leak "someone just bid" as a
 *   timing signal.
 * - Anything else (unknown role, unknown topic) fails closed.
 */

export type LiveTopic =
  /** One shift's admin page: shift, campaign, every bid, outreach, activity. */
  | { kind: "admin-shift"; shiftId: string }
  /** The admin shift lists (`/admin`, `/admin/shifts`). */
  | { kind: "admin-shifts" }
  /** One shift as a worker sees it: its status plus their OWN bid only. */
  | { kind: "worker-shift"; shiftId: string }
  /** The open shifts a worker can bid on. */
  | { kind: "worker-open-shifts" }
  /** The worker's own bids. */
  | { kind: "worker-bids" };

export type LiveTopicKind = LiveTopic["kind"];

const SHIFT_SCOPED: ReadonlySet<string> = new Set<LiveTopicKind>(["admin-shift", "worker-shift"]);
const UNSCOPED: ReadonlySet<string> = new Set<LiveTopicKind>([
  "admin-shifts",
  "worker-open-shifts",
  "worker-bids",
]);

/** Ids are cuids; anything outside this shape is rejected before a DB read. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Parse `kind` or `kind:<shiftId>`. Returns null for anything malformed. */
export function parseLiveTopic(raw: string | null | undefined): LiveTopic | null {
  if (!raw) return null;
  const separator = raw.indexOf(":");
  const kind = (separator === -1 ? raw : raw.slice(0, separator)) as LiveTopicKind;
  const arg = separator === -1 ? null : raw.slice(separator + 1);

  if (SHIFT_SCOPED.has(kind)) {
    if (!arg || !ID_PATTERN.test(arg)) return null;
    return { kind, shiftId: arg } as LiveTopic;
  }
  if (UNSCOPED.has(kind) && arg === null) {
    return { kind } as LiveTopic;
  }
  return null;
}

/** The wire form of a topic; the inverse of {@link parseLiveTopic}. */
export function formatLiveTopic(topic: LiveTopic): string {
  return "shiftId" in topic ? `${topic.kind}:${topic.shiftId}` : topic.kind;
}

export type LiveTopicAccess =
  | {
      allowed: true;
      /**
       * For a shift-scoped topic: the filter the shift must match. The caller
       * MUST check a shift matches it and answer 404 otherwise - a shift the
       * actor can't read is indistinguishable from one that doesn't exist.
       */
      shiftWhere: Prisma.ShiftWhereInput | null;
    }
  | { allowed: false };

/** Whether `actor` may follow `topic`. Fails closed. */
export function liveTopicAccess(actor: Actor | null, topic: LiveTopic): LiveTopicAccess {
  if (!actor) return { allowed: false };

  const audience = topic.kind.startsWith("admin-")
    ? "ADMIN"
    : topic.kind.startsWith("worker-")
      ? "STAFF"
      : null;
  if (!audience || actor.role !== audience) return { allowed: false };

  return {
    allowed: true,
    shiftWhere: "shiftId" in topic ? shiftListWhere(actor, { id: topic.shiftId }) : null,
  };
}

/**
 * How often a page following each topic polls while visible. The admin shift
 * page is where a scheduler waits on a reply, so it is the tightest.
 */
export const LIVE_POLL_INTERVAL_MS: Record<LiveTopicKind, number> = {
  "admin-shift": 3_000,
  "admin-shifts": 10_000,
  "worker-shift": 5_000,
  "worker-open-shifts": 15_000,
  "worker-bids": 15_000,
};
