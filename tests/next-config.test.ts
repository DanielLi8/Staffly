import { describe, expect, it } from "vitest";
import config from "../next.config.mjs";

describe("security response headers", () => {
  it("declares the recommended headers for every route", async () => {
    const groups = await config.headers?.();
    expect(groups).toEqual([
      expect.objectContaining({
        source: "/(.*)",
        headers: expect.arrayContaining([
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ]),
      }),
    ]);
  });
});

describe("content security policy (F9)", () => {
  it("ships a report-only CSP and drops the framework banner", async () => {
    const [group] = (await config.headers?.()) ?? [];
    const csp = group.headers.find((h: { key: string }) => h.key === "Content-Security-Policy-Report-Only")?.value;
    expect(csp).toBeDefined();
    for (const directive of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "report-uri /api/csp-report",
    ]) {
      expect(csp).toContain(directive);
    }
    expect(config.poweredByHeader).toBe(false);
  });
});
