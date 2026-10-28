// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { POST } from "@/app/api/csp-report/route";

/** The report-only CSP's receiver logs one short, query-free line per report. */

const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
afterEach(() => warn.mockClear());

function post(body: string) {
  return POST(new Request("http://localhost/api/csp-report", { method: "POST", body }));
}

describe("CSP report receiver", () => {
  it("logs the directive, blocked origin and page path only", async () => {
    const res = await post(
      JSON.stringify({
        "csp-report": {
          "document-uri": "https://staffly.example/worker/shifts/abc?token=secret",
          "violated-directive": "script-src-elem",
          "blocked-uri": "https://cdn.evil.example/x.js?user=maria",
        },
      })
    );
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledWith("[csp] script-src-elem blocked https://cdn.evil.example on /worker/shifts/abc");
  });

  it("accepts Reporting API batches and ignores junk", async () => {
    await post(JSON.stringify([{ body: { effectiveDirective: "img-src", blockedURL: "data", documentURL: "https://s.example/" } }]));
    expect(warn).toHaveBeenCalledWith("[csp] img-src blocked data on /");
    warn.mockClear();
    expect((await post("not json")).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });
});
