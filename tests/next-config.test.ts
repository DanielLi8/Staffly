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
