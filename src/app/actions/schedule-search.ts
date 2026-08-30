"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export type ScheduleSearchScope = "staff" | "department";

export interface ScheduleSearchStaffResult {
  type: "staff";
  id: string;
  name: string;
  position: string | null;
}

export interface ScheduleSearchDepartmentResult {
  type: "department";
  id: string;
  name: string;
  code: string;
}

export type ScheduleSearchResult = ScheduleSearchStaffResult | ScheduleSearchDepartmentResult;

const RESULT_LIMIT = 6;

/**
 * The search behind `/admin/schedule`'s two search boxes (staff / department,
 * kept as distinct modes rather than one combined typeahead) - the sole
 * navigation for that page (no department picker sidebar). ADMIN-only,
 * matching the page's own gate; a short/empty query returns nothing rather
 * than the full staff/department list, since this is a typeahead, not a
 * browser.
 */
export async function searchScheduleTargets(
  query: string,
  scope: ScheduleSearchScope
): Promise<ScheduleSearchResult[]> {
  await requireAuth("ADMIN");

  const q = query.trim();
  if (q.length < 2) return [];

  if (scope === "staff") {
    const staff = await db.user.findMany({
      where: { role: "STAFF", name: { contains: q, mode: "insensitive" } },
      select: { id: true, name: true, position: true },
      orderBy: { name: "asc" },
      take: RESULT_LIMIT,
    });
    return staff.map((s) => ({ type: "staff" as const, id: s.id, name: s.name, position: s.position }));
  }

  const departments = await db.department.findMany({
    where: {
      OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }],
    },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
    take: RESULT_LIMIT,
  });
  return departments.map((d) => ({ type: "department" as const, id: d.id, name: d.name, code: d.code }));
}
