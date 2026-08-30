import { notFound, redirect } from "next/navigation";
import { format, eachDayOfInterval } from "date-fns";
import { ShieldCheck } from "lucide-react";
import { getSession, actorFromSession } from "@/lib/auth";
import { getDepartmentIcon } from "@/lib/department-icons";
import { CalendarNav, primaryScheduleHeading } from "@/features/schedule/calendar-nav";
import { LocationScheduleGrid, LocationScheduleMonthHeatmap } from "@/features/location-schedule/grid-view";
import { loadLocationSchedule } from "@/lib/location-schedule/load";
import { parseScheduleAnchor, parseScheduleView, resolveScheduleRange, type ScheduleView } from "@/lib/schedule/range";

export const metadata = { title: "Department Schedule – Staffly" };

function scheduleHref(date: Date, view: ScheduleView) {
  return `/clerk?date=${format(date, "yyyy-MM-dd")}&view=${view}`;
}

export default async function ClerkSchedulePage({
  searchParams,
}: {
  searchParams: { date?: string; view?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.role !== "UNIT_CLERK") redirect("/");

  const actor = actorFromSession(session);
  if (!actor.clerkDepartmentId) {
    return (
      <div className="card-base p-12 text-center text-neutral-500 text-sm">
        No department is assigned to your account. Contact an admin for access.
      </div>
    );
  }

  const anchor = parseScheduleAnchor(searchParams.date);
  const view = parseScheduleView(searchParams.view);
  const { rangeStart, rangeEnd, weekStart, weekEnd, weekDays, monthStart, monthEnd, prevDate, nextDate } =
    resolveScheduleRange(view, anchor);

  const days = view === "day" ? [anchor] : view === "week" ? weekDays : eachDayOfInterval({ start: monthStart, end: monthEnd });

  const result = await loadLocationSchedule(actor, actor.clerkDepartmentId, { gte: rangeStart, lt: rangeEnd }, days);
  if (!result) notFound();

  const DeptIcon = getDepartmentIcon(result.department.iconKey);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
            <DeptIcon className="w-6 h-6 text-primary-700" aria-hidden />
          </div>
          <div>
            <h1 className="page-title text-3xl md:text-4xl">{result.department.name}</h1>
            <p className="text-sm text-neutral-500 mt-2 max-w-xl">
              Read-only schedule for {result.department.name} ({result.department.code}).
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 text-neutral-600 border border-neutral-200 px-3 py-1 text-xs font-medium shrink-0">
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden />
          Read-only
        </span>
      </div>

      <CalendarNav
        heading={primaryScheduleHeading(anchor, view, weekStart, weekEnd)}
        anchor={anchor}
        view={view}
        prevDate={prevDate}
        nextDate={nextDate}
        hrefFor={scheduleHref}
      />

      {view === "month" ? (
        <LocationScheduleMonthHeatmap days={days} rows={result.rows} dayHref={(d) => scheduleHref(d, "day")} />
      ) : (
        <LocationScheduleGrid days={days} rows={result.rows} />
      )}
    </div>
  );
}
