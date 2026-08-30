"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

const createDepartmentSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).max(32),
  iconKey: z.string().optional(),
  wing: z.string().optional(),
});

export async function createDepartment(raw: unknown) {
  await requireAuth("ADMIN");
  const data = createDepartmentSchema.parse(raw);

  const maxOrder = await db.department.aggregate({ _max: { sortOrder: true } });
  const sortOrder = (maxOrder._max.sortOrder ?? 0) + 1;

  await db.department.create({
    data: {
      name: data.name,
      code: data.code.toUpperCase(),
      iconKey: data.iconKey ?? "star",
      wing: data.wing,
      sortOrder,
    },
  });

  revalidatePath("/admin/departments");
}

const assignStaffSchema = z.object({
  departmentId: z.string().min(1),
  userId: z.string().min(1),
  title: z.string().min(1),
});

export async function assignStaffToDepartment(raw: unknown) {
  await requireAuth("ADMIN");
  const data = assignStaffSchema.parse(raw);

  await db.departmentMembership.upsert({
    where: {
      departmentId_userId: {
        departmentId: data.departmentId,
        userId: data.userId,
      },
    },
    update: { title: data.title },
    create: {
      departmentId: data.departmentId,
      userId: data.userId,
      title: data.title,
    },
  });

  revalidatePath("/admin/departments");
}
