import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getDepartmentIcon } from "@/lib/department-icons";
import { loadStaffingTargets } from "@/lib/staffing/store";
import { StaffingTargetsEditor } from "@/features/staffing-targets/staffing-targets-editor";

export const metadata = { title: "Staffing Targets – Staffly" };

/**
 * `/admin/departments/[id]/targets` - a department's projected staffing: the
 * one place the numbers are edited (captain decision projected-edit-scope).
 * ADMIN only; middleware already fences `/admin/*`, this re-checks.
 */
export default async function DepartmentTargetsPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.user.role !== "ADMIN") redirect("/worker");

  const view = await loadStaffingTargets(params.id);
  if (!view) notFound();

  const { department } = view;
  const Icon = getDepartmentIcon(department.iconKey);
  const subtitle = [department.code, department.unitLabel && `Unit ${department.unitLabel}`, department.location]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-3">
        <Link
          href="/admin/staffing-targets"
          className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 text-sm font-medium text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          All departments
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-primary-100 bg-primary-50">
            <Icon className="h-5 w-5 text-primary-700" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="page-title">{department.name} staffing</h1>
            <p className="text-xs uppercase tracking-wide text-neutral-500">{subtitle}</p>
          </div>
        </div>
      </div>
      <StaffingTargetsEditor view={view} />
    </div>
  );
}
