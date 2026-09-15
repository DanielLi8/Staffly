"use server";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export type ScheduleSearchScope = "staff" | "department";

export interface ScheduleSearchStaffResult {
  type: "staff";
  id: string;
  name: string;
  position: string | null;
  department: string | null;
}

export interface ScheduleSearchDepartmentResult {
  type: "department";
  id: string;
  name: string;
  code: string;
}

export type ScheduleSearchResult = ScheduleSearchStaffResult | ScheduleSearchDepartmentResult;

const RESULT_LIMIT = 6;

// Alphabetical first-N default shown before any typing - see the
// getDefaultScheduleTargets doc comment for why this default was chosen.
const STAFF_DEFAULT_LIMIT = 8;

async function fetchStaffResults(
  where: Prisma.UserWhereInput,
  take: number
): Promise<ScheduleSearchStaffResult[]> {
  const staff = await db.user.findMany({
    where,
    select: { id: true, name: true, position: true, department: true },
    orderBy: { name: "asc" },
    take,
  });
  return staff.map((s) => ({
    type: "staff" as const,
    id: s.id,
    name: s.name,
    position: s.position,
    department: s.department,
  }));
}

async function fetchDepartmentResults(
  where: Prisma.DepartmentWhereInput
): Promise<ScheduleSearchDepartmentResult[]> {
  const departments = await db.department.findMany({
    where,
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });
  return departments.map((d) => ({ type: "department" as const, id: d.id, name: d.name, code: d.code }));
}

/**
 * The search behind `/admin/schedule`'s two search boxes (staff / department,
 * kept as distinct modes rather than one combined typeahead) - the sole
 * navigation for that page (no department picker sidebar). ADMIN-only,
 * matching the page's own gate; a short/empty query returns nothing rather
 * than the full staff/department list, since this is a typeahead, not a
 * browser - see getDefaultScheduleTargets for the pre-typing suggestion list.
 */
export async function searchScheduleTargets(
  query: string,
  scope: ScheduleSearchScope
): Promise<ScheduleSearchResult[]> {
  await requireAuth("ADMIN");

  const q = query.trim();
  if (q.length < 2) return [];

  if (scope === "staff") {
    return fetchStaffResults({ role: "STAFF", name: { contains: q, mode: "insensitive" } }, RESULT_LIMIT);
  }

  return fetchDepartmentResults({
    OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }],
  });
}

/**
 * The suggestion list shown immediately on focus/click, before any text is
 * typed - departments are few enough per hospital that the full list is
 * returned as-is (no cap); staff lists can be large, so this caps at
 * STAFF_DEFAULT_LIMIT alphabetically rather than dumping the whole roster.
 * Typing still narrows to the real match via searchScheduleTargets, so the
 * cap never blocks reaching a staff member outside the first N - it's a
 * starting point, not the only path to them.
 */
export async function getDefaultScheduleTargets(scope: ScheduleSearchScope): Promise<ScheduleSearchResult[]> {
  await requireAuth("ADMIN");

  if (scope === "staff") {
    return fetchStaffResults({ role: "STAFF" }, STAFF_DEFAULT_LIMIT);
  }

  return fetchDepartmentResults({});
}
