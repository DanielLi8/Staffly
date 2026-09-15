import type { Role } from "@prisma/client";

/**
 * An ADMIN can preview the app as a worker; STAFF has no view-mode concept at
 * all and is always WORKER. This is a separate axis from `Role` on purpose -
 * it controls only nav rendering and the `/admin/*` route gate below, never
 * `shiftReadScope`/`shiftListWhere` or any other authz decision.
 */
export type ViewMode = "ADMIN" | "WORKER";

export const VIEW_MODE_COOKIE = "staffly-view-mode";

function isViewMode(value: string | undefined | null): value is ViewMode {
  return value === "ADMIN" || value === "WORKER";
}

/**
 * STAFF always resolves to WORKER regardless of any stray cookie value. ADMIN
 * defaults to ADMIN view (a fresh login, or an invalid/missing cookie) and
 * otherwise honors the persisted "view as" toggle.
 */
export function resolveViewMode(role: Role | undefined, cookieValue: string | undefined | null): ViewMode {
  if (role !== "ADMIN") return "WORKER";
  return isViewMode(cookieValue) ? cookieValue : "ADMIN";
}

export function homeForView(view: ViewMode): string {
  return view === "ADMIN" ? "/admin" : "/worker";
}

/**
 * Pure routing decision for the `/admin/*` gate, shared by `middleware.ts`
 * (enforcement) and its tests. Returns the redirect target, or null when the
 * request may proceed. A STAFF actor always resolves to WORKER view here, so
 * this reproduces today's STAFF-blocked behavior unchanged; an ADMIN actor
 * whose persisted view is WORKER is redirected the same way, closing the
 * URL-injection gap - only flipping the toggle back to ADMIN restores access.
 */
export function adminRouteRedirect(
  pathname: string,
  role: Role | undefined,
  cookieValue: string | undefined | null
): string | null {
  if (!pathname.startsWith("/admin")) return null;
  const view = resolveViewMode(role, cookieValue);
  if (view === "ADMIN") return null;
  return homeForView(view);
}
