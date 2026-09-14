import Link from "next/link";
import { CalendarDays, ListChecks, ArrowRight } from "lucide-react";
import { db } from "@/lib/db";
import { getSession, actorFromSession } from "@/lib/auth";
import { workerAvailableShiftWhere } from "@/lib/authz";
import { redirect } from "next/navigation";
import { shiftCardInclude } from "@/lib/shift-include";
import { endOfWeek, startOfWeek } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Staffly Portal – Dashboard" };

export default async function WorkerDashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const workerId = session.user.id;
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

  const [openShifts, scheduledWeek] = await Promise.all([
    db.shift.findMany({
      where: workerAvailableShiftWhere(actorFromSession(session)),
      orderBy: { startsAt: "asc" },
      take: 6,
      include: shiftCardInclude,
    }),
    db.shift.findMany({
      where: {
        assignedWorkerId: workerId,
        status: "ASSIGNED",
        startsAt: { gte: weekStart, lte: weekEnd },
      },
    }),
  ]);

  const hoursScheduled =
    scheduledWeek.reduce((acc, s) => acc + (s.endsAt.getTime() - s.startsAt.getTime()) / 3_600_000, 0) || 0;

  const first = session.user.name?.split(" ")[0] ?? "there";

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
        <div>
          <h1 className="page-title text-3xl md:text-4xl">Welcome back, {first}</h1>
        </div>
        <Card className="shrink-0 w-full lg:w-56 border-primary-100 shadow-card">
          <CardContent className="pt-5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Hours scheduled</p>
            <p className="text-2xl font-bold text-primary-900 mt-1">
              {hoursScheduled.toFixed(1)} <span className="text-neutral-400 font-medium">/ 40h</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link href="/worker/shifts" className="card-base p-6 flex flex-col gap-4 hover:border-primary-300 hover:shadow-lg transition-all group">
          <div className="flex items-start justify-between">
            <div className="h-12 w-12 rounded-xl bg-primary-50 text-primary-700 flex items-center justify-center">
              <ListChecks className="h-6 w-6" aria-hidden />
            </div>
            <ArrowRight className="h-5 w-5 text-neutral-300 group-hover:text-primary-600 group-hover:translate-x-0.5 transition-all" aria-hidden />
          </div>
          <div>
            <h2 className="section-title text-xl">Available Shifts</h2>
            <p className="text-sm text-neutral-500 mt-1">
              Browse and bid on {openShifts.length} open shift{openShifts.length !== 1 ? "s" : ""} matching your
              profile.
            </p>
          </div>
        </Link>

        <Link href="/worker/schedule" className="card-base p-6 flex flex-col gap-4 hover:border-primary-300 hover:shadow-lg transition-all group">
          <div className="flex items-start justify-between">
            <div className="h-12 w-12 rounded-xl bg-primary-50 text-primary-700 flex items-center justify-center">
              <CalendarDays className="h-6 w-6" aria-hidden />
            </div>
            <ArrowRight className="h-5 w-5 text-neutral-300 group-hover:text-primary-600 group-hover:translate-x-0.5 transition-all" aria-hidden />
          </div>
          <div>
            <h2 className="section-title text-xl">My Schedule</h2>
            <p className="text-sm text-neutral-500 mt-1">
              View your upcoming assigned shifts, {hoursScheduled.toFixed(1)}h scheduled this week.
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}
