import Link from "next/link";
import { CalendarDays, ListChecks, BarChart3, Building2, ArrowUpRight } from "lucide-react";
import { db } from "@/lib/db";
import { getSession, actorFromSession } from "@/lib/auth";
import { workerAvailableShiftWhere } from "@/lib/authz";
import { resolveStaffDepartmentIds } from "@/lib/authz/staff-departments";
import { positionMatchesRole } from "@/lib/shifts/role-match";
import { redirect } from "next/navigation";
import { shiftCardInclude } from "@/lib/shift-include";
import { addDays, endOfWeek, format, isSameDay, startOfDay, startOfWeek } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { getDepartmentIcon } from "@/lib/department-icons";
import { formatShiftDate } from "@/lib/utils";
import { ShiftBlock } from "@/features/schedule/shift-block";

export const metadata = { title: "Staffly Portal – Dashboard" };

const AGENDA_DAYS = 5;

function ExpandLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      aria-label="Open"
      className="absolute top-4 right-4 text-neutral-300 hover:text-primary-600 transition-colors"
    >
      <ArrowUpRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}

export default async function WorkerDashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const actor = actorFromSession(session);
  const workerId = session.user.id;
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });
  const agendaStart = startOfDay(new Date());
  const agendaEnd = addDays(agendaStart, AGENDA_DAYS);

  const [matchableShifts, scheduledWeek, upcomingAssigned, bidCount, staffDepartmentIds, worker] =
    await Promise.all([
    db.shift.findMany({
      where: workerAvailableShiftWhere(actor),
      orderBy: { startsAt: "asc" },
      include: shiftCardInclude,
    }),
    db.shift.findMany({
      where: {
        assignedWorkerId: workerId,
        status: "ASSIGNED",
        startsAt: { gte: weekStart, lte: weekEnd },
      },
    }),
    db.shift.findMany({
      where: {
        assignedWorkerId: workerId,
        status: "ASSIGNED",
        startsAt: { gte: agendaStart, lt: agendaEnd },
      },
      orderBy: { startsAt: "asc" },
      include: { department: { select: { name: true, code: true } } },
    }),
    db.shiftBid.count({ where: { workerId } }),
    resolveStaffDepartmentIds(actor),
    db.user.findUnique({ where: { id: workerId }, select: { position: true } }),
  ]);

  const openShifts = matchableShifts
    .filter((s) => positionMatchesRole(worker?.position, s.roleNeeded))
    .slice(0, 6);

  const hoursScheduled =
    scheduledWeek.reduce((acc, s) => acc + (s.endsAt.getTime() - s.startsAt.getTime()) / 3_600_000, 0) || 0;

  const departments = staffDepartmentIds.length
    ? await db.department.findMany({
        where: { id: { in: staffDepartmentIds } },
        orderBy: { sortOrder: "asc" },
        select: { name: true, code: true },
      })
    : [];

  const locationSummary =
    departments.length === 0
      ? "No department assigned"
      : departments.length === 1
        ? `${departments[0].name} (${departments[0].code})`
        : `${departments.length} departments`;

  const agendaDays = Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(agendaStart, i));

  const first = session.user.name?.split(" ")[0] ?? "there";

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div className="flex items-center gap-3">
          <Avatar name={session.user.name} size="lg" />
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
        {/* Available Shifts */}
        <div className="card-base p-5 relative flex flex-col">
          <ExpandLink href="/worker/shifts" />
          <Link href="/worker/shifts" className="flex flex-col gap-1">
            <div className="h-11 w-11 rounded-xl bg-primary-50 text-primary-700 flex items-center justify-center mb-2">
              <ListChecks className="h-5 w-5" aria-hidden />
            </div>
            <h2 className="section-title text-base">Available Shifts</h2>
            <p className="text-sm text-neutral-500">
              Browse and bid on {openShifts.length} open shift{openShifts.length !== 1 ? "s" : ""} matching your
              profile.
            </p>
          </Link>
          <div className="mt-3 max-h-48 overflow-y-auto pr-1">
            {openShifts.length === 0 ? (
              <p className="text-xs text-neutral-400 italic py-2">No open shifts right now.</p>
            ) : (
              openShifts.map((shift) => {
                const Icon = getDepartmentIcon(shift.department.iconKey);
                return (
                  <Link
                    key={shift.id}
                    href={`/worker/shifts/${shift.id}`}
                    className="flex items-center gap-3 py-2 border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60 rounded-lg px-1 -mx-1"
                  >
                    <div className="w-8 h-8 rounded-lg bg-sky-50 border border-sky-100 flex items-center justify-center text-sky-800 shrink-0">
                      <Icon className="w-4 h-4" aria-hidden />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-neutral-900 truncate">{shift.department.name}</p>
                      <p className="text-[11px] text-neutral-500 truncate">{shift.roleNeeded}</p>
                    </div>
                    <p className="text-[11px] text-neutral-500 shrink-0 text-right">
                      {formatShiftDate(shift.startsAt)}
                    </p>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        {/* My Schedule */}
        <div className="card-base p-5 relative flex flex-col">
          <ExpandLink href="/worker/schedule" />
          <Link href="/worker/schedule" className="flex flex-col gap-1">
            <div className="h-11 w-11 rounded-xl bg-primary-50 text-primary-700 flex items-center justify-center mb-2">
              <CalendarDays className="h-5 w-5" aria-hidden />
            </div>
            <h2 className="section-title text-base">My Schedule</h2>
            <p className="text-sm text-neutral-500">{hoursScheduled.toFixed(1)}h scheduled this week.</p>
          </Link>
          <div className="mt-3 max-h-48 overflow-y-auto pr-1 space-y-1">
            {agendaDays.map((day) => {
              const dayShifts = upcomingAssigned.filter((s) => isSameDay(s.startsAt, day));
              return (
                <div key={day.toISOString()} className="flex items-start gap-3 py-1.5 border-b border-neutral-100 last:border-0">
                  <div className="w-11 shrink-0 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">
                      {format(day, "EEE")}
                    </p>
                    <p className="text-xs font-semibold text-neutral-700">{format(day, "MMM d")}</p>
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    {dayShifts.length === 0 ? (
                      <p className="text-xs text-neutral-400 italic pt-1">Nothing scheduled</p>
                    ) : (
                      dayShifts.map((shift) => <ShiftBlock key={shift.id} shift={shift} compact />)
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Shift Bids */}
        <div className="card-base p-5 relative flex flex-col">
          <ExpandLink href="/worker/bids" />
          <Link href="/worker/bids" className="flex flex-col gap-1">
            <div className="h-11 w-11 rounded-xl bg-primary-50 text-primary-700 flex items-center justify-center mb-2">
              <BarChart3 className="h-5 w-5" aria-hidden />
            </div>
            <h2 className="section-title text-base">Shift Bids</h2>
            <p className="text-sm text-neutral-500">
              {bidCount} request{bidCount !== 1 ? "s" : ""} in your history.
            </p>
          </Link>
        </div>

        {/* Location Schedule */}
        <div className="card-base p-5 relative flex flex-col">
          <ExpandLink href="/worker/location" />
          <Link href="/worker/location" className="flex flex-col gap-1">
            <div className="h-11 w-11 rounded-xl bg-primary-50 text-primary-700 flex items-center justify-center mb-2">
              <Building2 className="h-5 w-5" aria-hidden />
            </div>
            <h2 className="section-title text-base">Location Schedule</h2>
            <p className="text-sm text-neutral-500">{locationSummary}</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
