"use server";

import { createDepartment } from "@/app/actions/departments";

export async function createDepartmentFormAction(formData: FormData) {
  await createDepartment({
    name: String(formData.get("name") ?? ""),
    code: String(formData.get("code") ?? ""),
  });
}
