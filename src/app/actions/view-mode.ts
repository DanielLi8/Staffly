"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth";
import { VIEW_MODE_COOKIE, homeForView, type ViewMode } from "@/lib/view-mode";

const VIEW_MODE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * The only way an ADMIN's "view as" state changes. ADMIN-only - STAFF has no
 * view-mode concept - and re-checked server-side via `requireActor` rather
 * than trusted from the client, since this cookie is what `middleware.ts`
 * gates `/admin/*` on.
 */
export async function setViewMode(mode: ViewMode): Promise<void> {
  await requireActor("ADMIN");

  cookies().set(VIEW_MODE_COOKIE, mode, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: VIEW_MODE_COOKIE_MAX_AGE_SECONDS,
  });

  redirect(homeForView(mode));
}
