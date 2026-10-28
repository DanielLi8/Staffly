import type { Role } from "@prisma/client";
import { can } from "@/lib/authz/capabilities";

/**
 * Anyone holding `portal.admin` (ADMIN today) can preview the app as a
 * worker; everyone else has no view-mode concept at all and is always WORKER. This is a separate axis from `Role` on purpose -
 * it controls only nav rendering and the `/admin/*` route gate below, never
 * `shiftReadScope`/`shiftListWhere` or any other authz decision.
 */
export type ViewMode = "ADMIN" | "WORKER";

export const VIEW_MODE_COOKIE = "staffly-view-mode";

function isViewMode(value: string | undefined | null): value is ViewMode {
  return value === "ADMIN" || value === "WORKER";
}

/**
 * Without `portal.admin` (STAFF today) this always resolves to WORKER,
 * regardless of any stray cookie value. An admin defaults to ADMIN view (a fresh login, or an invalid/missing cookie) and
 * otherwise honors the persisted "view as" toggle.
 */
export function resolveViewMode(role: Role | undefined, cookieValue: string | undefined | null): ViewMode {
  if (!role || !can({ role }, "portal.admin")) return "WORKER";
  return isViewMode(cookieValue) ? cookieValue : "ADMIN";
}

export function homeForView(view: ViewMode): string {
  return view === "ADMIN" ? "/admin" : "/worker";
}

/**
 * Pure routing decision for the `/admin/*` gate, shared by `middleware.ts`
 * (enforcement) and its tests. Returns the redirect target, or null when the
 * request may proceed. An actor without `portal.admin` (STAFF today) always
 * resolves to WORKER view here, so this keeps them blocked; an admin
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
