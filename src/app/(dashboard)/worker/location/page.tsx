import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { format, eachDayOfInterval } from "date-fns";
import { ShieldCheck } from "lucide-react";
import { getSession, actorFromSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveStaffDepartmentIds } from "@/lib/authz/staff-departments";
import { getDepartmentIcon } from "@/lib/department-icons";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarNav, primaryScheduleHeading } from "@/features/schedule/calendar-nav";
import { LocationScheduleGrid, LocationScheduleMonthHeatmap } from "@/features/location-schedule/grid-view";
import { loadLocationSchedule } from "@/lib/location-schedule/load";
import { parseScheduleAnchor, parseScheduleView, resolveScheduleRange, type ScheduleView } from "@/lib/schedule/range";

export const metadata = { title: "Location Schedule – Staffly" };

function scheduleHref(departmentId: string, date: Date, view: ScheduleView) {
  return `/worker/location?dept=${departmentId}&date=${format(date, "yyyy-MM-dd")}&view=${view}`;
}

/**
 * Read-only Location Schedule for a STAFF member's own department(s) - "the
 * unit they work in." The department picker (only rendered when a member
 * belongs to more than one) is built exclusively from `staffDepartmentIds`,
 * never the full department list, matching the same restriction the loader
 * itself enforces via `canViewLocationSchedule`.
 */
export default async function WorkerLocationSchedulePage({
  searchParams,
}: {
  searchParams: { dept?: string; date?: string; view?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.role !== "STAFF") redirect("/");

  const actor = actorFromSession(session);
  const staffDepartmentIds = await resolveStaffDepartmentIds(actor);

  if (staffDepartmentIds.length === 0) {
    return (
      <div className="card-base">
        <EmptyState
          icon={ShieldCheck}
          title="No department assigned"
          description="You aren't a member of any department yet. Contact an admin for access."
        />
      </div>
    );
  }

  const departments = await db.department.findMany({
    where: { id: { in: staffDepartmentIds } },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, code: true, iconKey: true, wing: true },
  });

  const selectedId =
    searchParams.dept && departments.some((d) => d.id === searchParams.dept) ? searchParams.dept : departments[0].id;
  const selected = departments.find((d) => d.id === selectedId)!;

  const anchor = parseScheduleAnchor(searchParams.date);
  const view = parseScheduleView(searchParams.view);
  const { rangeStart, rangeEnd, weekStart, weekEnd, weekDays, monthStart, monthEnd, prevDate, nextDate } =
    resolveScheduleRange(view, anchor);

  const days = view === "day" ? [anchor] : view === "week" ? weekDays : eachDayOfInterval({ start: monthStart, end: monthEnd });

  const result = await loadLocationSchedule(actor, selected.id, { gte: rangeStart, lt: rangeEnd }, days, staffDepartmentIds);
  if (!result) notFound();

  const DeptIcon = getDepartmentIcon(result.department.iconKey);
  const hrefFor = (d: Date, v: ScheduleView) => scheduleHref(selected.id, d, v);

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

      {departments.length > 1 && (
        <div className="inline-flex flex-wrap rounded-full border border-neutral-200 p-0.5 bg-neutral-100 gap-0.5" role="group" aria-label="Department">
          {departments.map((d) => (
            <Link
              key={d.id}
              href={scheduleHref(d.id, anchor, view)}
              className={cn(
                "px-3 sm:px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors",
                d.id === selected.id ? "bg-white text-primary-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"
              )}
            >
              {d.name}
            </Link>
          ))}
        </div>
      )}

      <CalendarNav
        heading={primaryScheduleHeading(anchor, view, weekStart, weekEnd)}
        anchor={anchor}
        view={view}
        prevDate={prevDate}
        nextDate={nextDate}
        hrefFor={hrefFor}
      />

      {view === "month" ? (
        <LocationScheduleMonthHeatmap days={days} rows={result.rows} dayHref={(d) => scheduleHref(selected.id, d, "day")} />
      ) : (
        <LocationScheduleGrid days={days} rows={result.rows} />
      )}
    </div>
  );
}
