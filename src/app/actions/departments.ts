"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { DEPARTMENT_ICON_KEYS } from "@/lib/department-icons";
import {
  DEPARTMENT_MESSAGES,
  validateDepartmentInput,
  type DepartmentFieldErrors,
} from "@/lib/departments/validation";

/**
 * The department list on the Staff page (`/admin/workers`): add a department
 * or edit its name, code, wing and icon. ADMIN-only. Departments are never
 * deleted here - shifts, availability and memberships reference them.
 * Validation and races come back typed, never thrown.
 */

export type DepartmentActionResult =
  | { ok: true; id: string }
  | { ok: false; fieldErrors: DepartmentFieldErrors; formError?: string };

const formSchema = z.object({
  name: z.string(),
  code: z.string(),
  wing: z.string(),
  iconKey: z.string(),
});

const INVALID_REQUEST: DepartmentActionResult = {
  ok: false,
  fieldErrors: {},
  formError: "Something in the form couldn't be read. Reload the page and try again.",
};

function codeTaken(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function revalidateDepartments() {
  revalidatePath("/admin/workers", "layout");
  revalidatePath("/admin/schedule");
  revalidatePath("/admin/shifts/new");
}

export async function createDepartment(raw: unknown): Promise<DepartmentActionResult> {
  const session = await requireAuth("ADMIN");
  const parsed = formSchema.safeParse(raw);
  if (!parsed.success) return INVALID_REQUEST;
  const validation = validateDepartmentInput(parsed.data, DEPARTMENT_ICON_KEYS);
  if (!validation.ok) return { ok: false, fieldErrors: validation.fieldErrors };
  const record = validation.record;

  if (await db.department.findUnique({ where: { code: record.code }, select: { id: true } })) {
    return { ok: false, fieldErrors: { code: DEPARTMENT_MESSAGES.codeTaken } };
  }

  const actor = await db.user.findUnique({ where: { id: session.user.id }, select: { hospitalId: true } });
  try {
    const created = await db.$transaction(async (tx) => {
      const last = await tx.department.aggregate({ _max: { sortOrder: true } });
      const department = await tx.department.create({
        data: { ...record, sortOrder: (last._max.sortOrder ?? 0) + 1, hospitalId: actor?.hospitalId ?? null },
        select: { id: true },
      });
      await writeAudit(tx, {
        actorId: session.user.id,
        action: "DEPARTMENT_CREATED",
        targetType: "Department",
        targetId: department.id,
        hospitalId: actor?.hospitalId,
        metadata: { ...record },
      });
      return department;
    });
    revalidateDepartments();
    return { ok: true, id: created.id };
  } catch (err) {
    if (codeTaken(err)) return { ok: false, fieldErrors: { code: DEPARTMENT_MESSAGES.codeTaken } };
    throw err;
  }
}

export async function updateDepartment(departmentId: string, raw: unknown): Promise<DepartmentActionResult> {
  const session = await requireAuth("ADMIN");
  const parsed = formSchema.safeParse(raw);
  if (typeof departmentId !== "string" || !departmentId || !parsed.success) return INVALID_REQUEST;
  const validation = validateDepartmentInput(parsed.data, DEPARTMENT_ICON_KEYS);
  if (!validation.ok) return { ok: false, fieldErrors: validation.fieldErrors };
  const record = validation.record;

  const existing = await db.department.findUnique({ where: { id: departmentId }, select: { hospitalId: true } });
  if (!existing) return { ok: false, fieldErrors: {}, formError: "This department no longer exists." };

  const clash = await db.department.findFirst({
    where: { code: record.code, id: { not: departmentId } },
    select: { id: true },
  });
  if (clash) return { ok: false, fieldErrors: { code: DEPARTMENT_MESSAGES.codeTaken } };

  try {
    await db.$transaction(async (tx) => {
      await tx.department.update({ where: { id: departmentId }, data: record });
      await writeAudit(tx, {
        actorId: session.user.id,
        action: "DEPARTMENT_UPDATED",
        targetType: "Department",
        targetId: departmentId,
        hospitalId: existing.hospitalId,
        metadata: { ...record },
      });
    });
  } catch (err) {
    if (codeTaken(err)) return { ok: false, fieldErrors: { code: DEPARTMENT_MESSAGES.codeTaken } };
    throw err;
  }
  revalidateDepartments();
  return { ok: true, id: departmentId };
}
