import Link from "next/link";
import { Plus, CalendarClock } from "lucide-react";
import { ShiftCard } from "@/features/shifts/shift-card";
import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { shiftCardInclude } from "@/lib/shift-include";
import type { ShiftWithRelations } from "@/types";

export const metadata = { title: "Shifts – Staffly" };

export default async function AdminShiftsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const session = await getSession();
  if (!session || session.user.role !== "SCHEDULER") redirect("/worker/shifts");

  const activeStatus = searchParams.status ?? "OPEN";
  const validStatuses = ["OPEN", "ASSIGNED", "CLOSED", "CANCELLED", "all"] as const;
  const filter = validStatuses.includes(activeStatus as (typeof validStatuses)[number])
    ? activeStatus
    : "OPEN";

  const shifts = await db.shift.findMany({
    where: filter !== "all" ? { status: filter as "OPEN" | "ASSIGNED" | "CLOSED" | "CANCELLED" } : {},
    orderBy: { startsAt: "asc" },
    include: shiftCardInclude,
  });

  const tabs = [
    { label: "Open", value: "OPEN" },
    { label: "Assigned", value: "ASSIGNED" },
    { label: "Closed", value: "CLOSED" },
    { label: "All", value: "all" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="page-title">All Shifts</h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            {shifts.length} shift{shifts.length !== 1 ? "s" : ""} shown
          </p>
        </div>
        <Link
          href="/admin/shifts/new"
          className="inline-flex items-center gap-2 h-10 px-4 text-sm font-semibold rounded-xl bg-primary-700 text-white hover:bg-primary-800 transition-colors"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Create New Shift
        </Link>
      </div>

      <nav className="flex gap-1 border-b border-neutral-200" aria-label="Shift status filter">
        {tabs.map((tab) => {
          const active = filter === tab.value;
          return (
            <Link
              key={tab.value}
              href={`/admin/shifts?status=${tab.value}`}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active
                  ? "border-primary-600 text-primary-700"
                  : "border-transparent text-neutral-500 hover:text-neutral-700"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {shifts.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No shifts found"
          description="Create a new shift to notify eligible staff."
          action={
            <Link
              href="/admin/shifts/new"
              className="inline-flex items-center gap-2 h-10 px-4 text-sm font-semibold rounded-xl bg-primary-700 text-white hover:bg-primary-800 transition-colors"
            >
              Create New Shift
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {shifts.map((shift) => (
            <ShiftCard
              key={shift.id}
              shift={shift as ShiftWithRelations}
              href={`/admin/shifts/${shift.id}`}
              showBidCount
            />
          ))}
        </div>
      )}
    </div>
  );
}
