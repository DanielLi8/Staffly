import { NextResponse } from "next/server";
import { buildHealthReport } from "@/lib/health/checks";
import { HEALTH_TOKEN_HEADER, isDetailAuthorized, probeDatabase } from "@/lib/health/probe";

// Health must be computed per request and never cached by anyone.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * `GET /api/health` - the uptime monitor's target (go-live plan sec 4.2).
 * Public: `/api` sits outside the NextAuth middleware matcher. Answers 200
 * `{"status":"ok"}` or 503 `{"status":"degraded"}`; the per-check breakdown
 * (DB + latency, running region, which required config is present, build
 * version) is added only for a caller sending `X-Health-Token` equal to
 * `HEALTH_CHECK_TOKEN`. Either way the body is statuses and booleans only.
 */
export async function GET(request: Request) {
  const report = buildHealthReport(process.env, await probeDatabase());
  const detailed = isDetailAuthorized(request.headers.get(HEALTH_TOKEN_HEADER), process.env.HEALTH_CHECK_TOKEN);
  const body = detailed ? report : { status: report.status };
  return NextResponse.json(body, { status: report.status === "ok" ? 200 : 503, headers: NO_STORE });
}
