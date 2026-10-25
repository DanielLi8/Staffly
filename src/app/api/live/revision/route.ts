import { NextResponse } from "next/server";
import { actorFromSession, getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { liveTopicAccess, parseLiveTopic } from "@/lib/live/topics";
import { liveRevision } from "@/lib/live/revision";

// A revision is only useful fresh: never cache it anywhere.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function reply(body: Record<string, string>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * `GET /api/live/revision?topic=<topic>` -> `{ revision }`, the cheap "has
 * anything changed?" check behind `LiveRefresh`. `/api` sits outside the
 * NextAuth middleware matcher, so this does its own session check. The 4xx
 * answers are final - the client stops polling on them:
 *
 * - 400 malformed topic, 401 no session, 403 the actor's role may not follow
 *   this topic kind (checked before any lookup, so it leaks no existence),
 * - 404 the shift is gone or outside the actor's read scope, or the topic has
 *   no revision source.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user) return reply({ error: "Unauthorized" }, 401);

  const topic = parseLiveTopic(new URL(request.url).searchParams.get("topic"));
  if (!topic) return reply({ error: "Invalid topic" }, 400);

  const access = liveTopicAccess(actorFromSession(session), topic);
  if (!access.allowed) return reply({ error: "Forbidden" }, 403);

  if (access.shiftWhere) {
    const shift = await db.shift.findFirst({ where: access.shiftWhere, select: { id: true } });
    if (!shift) return reply({ error: "Not found" }, 404);
  }

  const revision = await liveRevision(topic);
  if (revision === null) return reply({ error: "Not found" }, 404);

  return reply({ revision }, 200);
}
