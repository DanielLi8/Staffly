import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Public and unauthenticated (browsers post here with no session), so read at
// most this much and log one short line - never the raw body.
const MAX_BODY = 8 * 1024;

/**
 * Receiver for the report-only Content-Security-Policy (`next.config.mjs`).
 * Logs which directive a page violated and the blocked origin, so the policy
 * can be tightened and then enforced. Accepts both the legacy `report-uri`
 * body ({"csp-report": {...}}) and Reporting API arrays.
 */
export async function POST(request: Request) {
  const text = (await request.text().catch(() => "")).slice(0, MAX_BODY);
  for (const report of parseReports(text).slice(0, 5)) {
    console.warn(
      `[csp] ${field(report, "violated-directive", "effectiveDirective")} blocked ${origin(field(report, "blocked-uri", "blockedURL"))} on ${path(field(report, "document-uri", "documentURL"))}`
    );
  }
  return new NextResponse(null, { status: 204 });
}

type Report = Record<string, unknown>;

function parseReports(text: string): Report[] {
  try {
    const body: unknown = JSON.parse(text);
    if (Array.isArray(body)) {
      return body.map((r) => (r as { body?: Report })?.body).filter((r): r is Report => !!r && typeof r === "object");
    }
    const legacy = (body as { "csp-report"?: Report } | null)?.["csp-report"];
    return legacy && typeof legacy === "object" ? [legacy] : [];
  } catch {
    return [];
  }
}

function field(report: Report, legacy: string, modern: string): string {
  const value = report[legacy] ?? report[modern];
  return typeof value === "string" ? value.slice(0, 200) : "?";
}

/** Only the origin of a blocked URL ("inline"/"eval" pass through) - never its path or query. */
function origin(uri: string): string {
  try {
    return new URL(uri).origin;
  } catch {
    return uri.replace(/[^a-z-]/gi, "").slice(0, 20) || "?";
  }
}

/** Only the path of the page - its query string can carry ids. */
function path(uri: string): string {
  try {
    return new URL(uri).pathname;
  } catch {
    return "?";
  }
}
