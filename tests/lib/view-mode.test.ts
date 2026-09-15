import { describe, it, expect } from "vitest";
import { adminRouteRedirect, homeForView, resolveViewMode } from "@/lib/view-mode";

describe("resolveViewMode", () => {
  it("STAFF always resolves to WORKER, regardless of any cookie value", () => {
    expect(resolveViewMode("STAFF", undefined)).toBe("WORKER");
    expect(resolveViewMode("STAFF", "ADMIN")).toBe("WORKER");
    expect(resolveViewMode("STAFF", "garbage")).toBe("WORKER");
  });

  it("ADMIN defaults to ADMIN view absent a valid cookie (fresh login)", () => {
    expect(resolveViewMode("ADMIN", undefined)).toBe("ADMIN");
    expect(resolveViewMode("ADMIN", null)).toBe("ADMIN");
    expect(resolveViewMode("ADMIN", "not-a-real-mode")).toBe("ADMIN");
  });

  it("ADMIN honors a valid persisted cookie in either direction", () => {
    expect(resolveViewMode("ADMIN", "ADMIN")).toBe("ADMIN");
    expect(resolveViewMode("ADMIN", "WORKER")).toBe("WORKER");
  });
});

describe("homeForView", () => {
  it("maps ADMIN view to /admin and WORKER view to /worker", () => {
    expect(homeForView("ADMIN")).toBe("/admin");
    expect(homeForView("WORKER")).toBe("/worker");
  });
});

describe("adminRouteRedirect", () => {
  it("lets non-/admin paths through regardless of role or view", () => {
    expect(adminRouteRedirect("/worker/shifts", "STAFF", undefined)).toBeNull();
    expect(adminRouteRedirect("/profile", "ADMIN", "WORKER")).toBeNull();
  });

  it("blocks STAFF from /admin/* (regression: unchanged from pre-toggle behavior)", () => {
    expect(adminRouteRedirect("/admin", "STAFF", undefined)).toBe("/worker");
    expect(adminRouteRedirect("/admin/shifts/123", "STAFF", undefined)).toBe("/worker");
  });

  it("allows ADMIN to reach /admin/* when current view is ADMIN (default, no cookie)", () => {
    expect(adminRouteRedirect("/admin", "ADMIN", undefined)).toBeNull();
    expect(adminRouteRedirect("/admin/shifts", "ADMIN", "ADMIN")).toBeNull();
  });

  it("blocks an ADMIN whose persisted view is WORKER from /admin/* by direct URL", () => {
    expect(adminRouteRedirect("/admin", "ADMIN", "WORKER")).toBe("/worker");
    expect(adminRouteRedirect("/admin/shifts/123", "ADMIN", "WORKER")).toBe("/worker");
  });
});
