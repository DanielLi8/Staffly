import Link from "next/link";
import { Clock } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { shiftCardInclude } from "@/lib/shift-include";
import type { ShiftWithRelations } from "@/types";
import { endOfWeek, format, startOfWeek } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { getBidUiStatus } from "@/lib/bid-display";
import { cn } from "@/lib/utils";

export const metadata = { title: "Staffly Portal – Dashboard" };

export default async function WorkerDashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const workerId = session.user.id;
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

  const [openShifts, myBids, scheduledWeek, notifications] = await Promise.all([
    db.shift.findMany({
      where: { status: "OPEN" },
      orderBy: { startsAt: "asc" },
      take: 6,
      include: shiftCardInclude,
    }),
    db.shiftBid.findMany({
      where: { workerId },
      orderBy: { createdAt: "desc" },
      take: 4,
      include: {
        shift: {
          include: { department: { select: { name: true, code: true } } },
        },
      },
    }),
    db.shift.findMany({
      where: {
        assignedWorkerId: workerId,
        status: "ASSIGNED",
        startsAt: { gte: weekStart, lte: weekEnd },
      },
    }),
    db.notification.findMany({
      where: { userId: workerId },
      orderBy: { createdAt: "desc" },
      take: 4,
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
          <p className="text-sm text-neutral-500 mt-2">
            You have {openShifts.length} open shift{openShifts.length !== 1 ? "s" : ""} matching your profile.
          </p>
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

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="section-title text-xl">Available Shifts</h2>
              <span className="text-xs font-bold bg-primary-100 text-primary-800 rounded-full px-2.5 py-0.5">
                {openShifts.length}
              </span>
            </div>
            <Link href="/worker/shifts" className="text-sm font-medium text-primary-700 hover:underline">
              Filter &amp; Sort
            </Link>
          </div>
          <div className="space-y-4">
            {openShifts.length === 0 ? (
              <p className="text-sm text-neutral-500 py-8">No open shifts at the moment.</p>
            ) : (
              openShifts.map((shift) => (
                <WorkerShiftHighlight key={shift.id} shift={shift as ShiftWithRelations} />
              ))
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-neutral-900">My requests</h2>
              <Link href="/worker/bids" className="text-xs font-medium text-primary-700 hover:underline">
                History
              </Link>
            </div>
            <div className="space-y-2">
              {myBids.length === 0 ? (
                <p className="text-sm text-neutral-500">No shift requests yet.</p>
              ) : (
                myBids.map((bid) => {
                  const ui = getBidUiStatus(bid.status, bid.shift);
                  return (
                    <div
                      key={bid.id}
                      className="rounded-xl border border-neutral-200/80 bg-white p-3 shadow-sm"
                    >
                      <p className="text-xs font-semibold text-neutral-800">
                        {bid.shift.department.code} · {format(bid.shift.startsAt, "MMM d")}
                      </p>
                      <div className="flex items-center gap-1.5 mt-2">
                        <span
                          className={cn(
                            "w-1.5 h-1.5 rounded-full",
                            ui === "pending" && "bg-slate-400",
                            (ui === "assigned" || ui === "completed") && "bg-blue-500",
                            ui === "not_selected" && "bg-rose-500"
                          )}
                        />
                        <span className="text-[11px] font-medium capitalize text-neutral-600">
                          {ui === "not_selected"
                            ? "Not selected"
                            : ui === "completed"
                              ? "Completed"
                              : ui === "assigned"
                                ? "Confirmed"
                                : "Pending"}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <h2 className="font-semibold text-neutral-900 mb-3">Notifications</h2>
            <ul className="space-y-3">
              {notifications.length === 0 ? (
                <li className="text-sm text-neutral-500">You&apos;re all caught up.</li>
              ) : (
                notifications.map((n) => (
                  <li key={n.id} className="text-sm border-l-2 border-primary-200 pl-3 py-1">
                    <p className="font-medium text-neutral-800">{n.title}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">{n.message}</p>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkerShiftHighlight({ shift }: { shift: ShiftWithRelations }) {
  const deadlineSoon = shift.bidDeadlineAt.getTime() - Date.now() < 4 * 60 * 60 * 1000;
  return (
    <div className="card-base p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="rounded-full bg-sky-50 text-sky-800 border border-sky-100 px-2.5 py-0.5 text-xs font-semibold">
          {shift.department.code}
        </span>
        {deadlineSoon && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-full px-2 py-0.5">
            <Clock className="w-3 h-3" aria-hidden />
            Deadline soon
          </span>
        )}
      </div>
      <p className="font-semibold text-neutral-900">{shift.roleNeeded}</p>
      <p className="text-xs text-neutral-500 mt-0.5">Internal shift</p>
      <div className="flex gap-4 mt-3 text-sm text-neutral-600">
        <span>{format(shift.startsAt, "EEEE, MMM d")}</span>
        <span>
          {format(shift.startsAt, "HH:mm")} – {format(shift.endsAt, "HH:mm")}
        </span>
      </div>
      <div className="flex gap-3 mt-4">
        <Link
          href={`/worker/shifts/${shift.id}`}
          className="flex-1 h-10 inline-flex items-center justify-center rounded-lg border border-neutral-200 bg-white text-sm font-medium text-neutral-800 hover:bg-neutral-50"
        >
          View Details
        </Link>
        <Link
          href={`/worker/shifts/${shift.id}`}
          className="flex-1 h-10 inline-flex items-center justify-center rounded-lg bg-primary-700 text-sm font-semibold text-white hover:bg-primary-800"
        >
          Bid for Shift
        </Link>
      </div>
    </div>
  );
}
