import Link from "next/link";
import { Plus } from "lucide-react";
import { ShiftCard } from "@/features/shifts/shift-card";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { formatCalendarDay, formatShiftRange } from "@/lib/utils";
import { getDepartmentIcon } from "@/lib/department-icons";
import { shiftCardInclude } from "@/lib/shift-include";
import type { ShiftWithRelations } from "@/types";

export const metadata = { title: "Clinical Operations – Staffly" };

export default async function AdminDashboardPage() {
  const session = await getSession();
  if (!session || session.user.role !== "SCHEDULER") redirect("/worker/shifts");

  const [openShifts, assignedShifts] = await Promise.all([
    db.shift.findMany({
      where: { status: "OPEN" },
      orderBy: { startsAt: "asc" },
      take: 8,
      include: shiftCardInclude,
    }),
    db.shift.findMany({
      where: { status: "ASSIGNED" },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: shiftCardInclude,
    }),
  ]);

  return (
    <div className="space-y-10">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="page-title text-3xl md:text-4xl">Clinical Operations</h1>
          <p className="text-sm text-neutral-500 mt-2 max-w-xl">
            Monitoring departmental efficiency and active shift fulfillment.
          </p>
        </div>
        <Link
          href="/admin/shifts/new"
          className="inline-flex items-center justify-center gap-2 h-11 px-5 text-sm font-semibold rounded-xl bg-primary-700 text-white hover:bg-primary-800 shadow-sm transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Create New Shift
        </Link>
      </div>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-title">Open Shifts</h2>
          <span className="pill-muted">Primary focus</span>
        </div>
        {openShifts.length === 0 ? (
          <div className="card-base p-12 text-center text-neutral-500 text-sm">
            No open shifts. Create one to notify staff.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {openShifts.map((shift) => (
              <ShiftCard key={shift.id} shift={shift as ShiftWithRelations} href={`/admin/shifts/${shift.id}`} showBidCount />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-title">Recently Assigned</h2>
          <Link href="/admin/shifts?status=ASSIGNED" className="text-sm font-medium text-primary-700 hover:underline">
            View History
          </Link>
        </div>
        {assignedShifts.length === 0 ? (
          <div className="card-base p-12 text-center text-neutral-500 text-sm">
            No assigned shifts yet.
          </div>
        ) : (
          <div className="space-y-3">
            {assignedShifts.map((shift) => (
              <AssignedRow key={shift.id} shift={shift as ShiftWithRelations} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AssignedRow({ shift }: { shift: ShiftWithRelations }) {
  const Icon = getDepartmentIcon(shift.department.iconKey);
  return (
    <div className="rounded-xl border border-neutral-200/80 bg-neutral-100/40 p-4 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex gap-3 flex-1 min-w-0">
        <div className="w-11 h-11 rounded-lg bg-white border border-neutral-200 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-primary-700" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-neutral-900">{shift.department.name}</p>
          <span className="inline-flex mt-1 rounded-full bg-sky-50 text-sky-800 border border-sky-100 px-2 py-0.5 text-[11px] font-medium">
            {shift.roleNeeded}
          </span>
          <p className="text-sm text-neutral-600 mt-2">
            {formatCalendarDay(shift.startsAt)} · {formatShiftRange(shift.startsAt, shift.endsAt)}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-6 sm:gap-8">
        <span className="inline-flex rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold">
          ASSIGNED
        </span>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Staff assigned</p>
          <div className="flex items-center justify-end gap-2 mt-1">
            <Avatar name={shift.assignedWorker?.name ?? "?"} size="sm" src={shift.assignedWorker?.image ?? undefined} />
            <span className="text-sm font-medium text-neutral-900">{shift.assignedWorker?.name}</span>
          </div>
        </div>
        <Link
          href={`/admin/shifts/${shift.id}`}
          className="text-sm font-medium text-primary-700 hover:underline whitespace-nowrap"
        >
          View Details →
        </Link>
      </div>
    </div>
  );
}
