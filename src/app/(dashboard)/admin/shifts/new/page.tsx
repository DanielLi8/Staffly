import Link from "next/link";
import { ChevronLeft, Info } from "lucide-react";
import { ShiftForm } from "@/features/shifts/shift-form";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

export const metadata = { title: "Create New Shift – Staffly" };

export default async function NewShiftPage() {
  const session = await getSession();
  if (!session || session.user.role !== "ADMIN") redirect("/worker/shifts");

  const departments = await db.department.findMany({
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, code: true },
  });

  return (
    <div className="max-w-5xl">
      <Link
        href="/admin/shifts"
        className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-700 mb-6 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        Back to Shifts
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
        <div className="lg:col-span-4 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-800/80">Administrative portal</p>
          <h1 className="page-title text-3xl lg:text-4xl">Create New Shift</h1>
          <div className="rounded-xl border border-neutral-200/80 bg-neutral-50/80 p-4 flex gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
              <Info className="w-4 h-4 text-primary-700" aria-hidden />
            </div>
            <div>
              <p className="font-semibold text-neutral-900 text-sm">Clinical Guidelines</p>
              <p className="text-sm text-neutral-600 mt-1">
                Ensure role certification matches unit requirements for compliance.
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-8">
          <div className="card-base p-6 lg:p-8">
            <ShiftForm departments={departments} />
          </div>
        </div>
      </div>
    </div>
  );
}
