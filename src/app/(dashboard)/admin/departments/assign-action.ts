"use server";

import { assignStaffToDepartment } from "@/app/actions/departments";

export async function assignStaffFormAction(formData: FormData) {
  await assignStaffToDepartment({
    departmentId: String(formData.get("departmentId") ?? ""),
    userId: String(formData.get("userId") ?? ""),
    title: String(formData.get("title") ?? ""),
  });
}
