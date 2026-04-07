import { CalendarClock } from "lucide-react";
import { ShiftCard } from "@/features/shifts/shift-card";
import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { shiftCardInclude } from "@/lib/shift-include";
import type { ShiftWithRelations } from "@/types";

export const metadata = { title: "Available Shifts – Staffly" };

export default async function WorkerShiftsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const shifts = await db.shift.findMany({
    where: { status: "OPEN" },
    orderBy: { startsAt: "asc" },
    include: shiftCardInclude,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Available Shifts</h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            {shifts.length} open shift{shifts.length !== 1 ? "s" : ""} available
          </p>
        </div>
        <span className="text-sm font-semibold text-primary-700 bg-primary-50 border border-primary-100 rounded-full px-3 py-1">
          {shifts.length}
        </span>
      </div>

      {shifts.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No open shifts"
          description="Check back soon — your staffing team will post new callout shifts here."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {shifts.map((shift) => (
            <ShiftCard key={shift.id} shift={shift as ShiftWithRelations} href={`/worker/shifts/${shift.id}`} />
          ))}
        </div>
      )}
    </div>
  );
}
