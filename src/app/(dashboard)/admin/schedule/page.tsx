import { notFound, redirect } from "next/navigation";
import { format, eachDayOfInterval } from "date-fns";
import { Search as SearchIcon } from "lucide-react";
import { getSession, actorFromSession } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/authz";
import { getDepartmentIcon } from "@/lib/department-icons";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarNav, primaryScheduleHeading } from "@/features/schedule/calendar-nav";
import { PersonalScheduleCalendar } from "@/features/schedule/personal-schedule-calendar";
import { LocationScheduleGrid, LocationScheduleMonthHeatmap } from "@/features/location-schedule/grid-view";
import { ScheduleSearchBox } from "@/features/location-schedule/schedule-search-box";
import { loadLocationSchedule } from "@/lib/location-schedule/load";
import { parseScheduleAnchor, parseScheduleView, resolveScheduleRange, type ScheduleView } from "@/lib/schedule/range";

export const metadata = { title: "Location Schedule – Staffly" };

type SelectionType = "staff" | "department";

function parseType(v: string | undefined): SelectionType | undefined {
  return v === "staff" || v === "department" ? v : undefined;
}

function scheduleHref(selection: { type: SelectionType; id: string }, date: Date, view: ScheduleView) {
  return `/admin/schedule?type=${selection.type}&id=${selection.id}&date=${format(date, "yyyy-MM-dd")}&view=${view}`;
}

/**
 * `/admin/schedule` - a single search-driven entry point, not a department
 * picker: the search box IS the navigation for both modes (see
 * `ScheduleSearchBox`). Selecting a STAFF result renders that person's
 * personal calendar (`PersonalScheduleCalendar`, shared with
 * `/worker/schedule`); selecting a DEPARTMENT result renders the Location
 * Schedule roster grid (`LocationScheduleGrid`/`LocationScheduleMonthHeatmap`).
 */
export default async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: { type?: string; id?: string; date?: string; view?: string };
}) {
  const session = await getSession();
  if (!session || session.user.role !== "ADMIN") redirect("/worker/shifts");
  const actor = actorFromSession(session);

  const type = parseType(searchParams.type);
  const id = searchParams.id;
  const anchor = parseScheduleAnchor(searchParams.date);
  const view = parseScheduleView(searchParams.view);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title text-3xl">Location Schedule</h1>
        <p className="text-sm text-neutral-500 mt-2 max-w-xl">
          Search for a staff member to see their personal schedule, or a department to see its roster.
        </p>
      </div>

      <ScheduleSearchBox />

      {!type || !id ? (
        <div className="card-base">
          <EmptyState
            icon={SearchIcon}
            title="Search to get started"
            description="Find a staff member or department above to view their schedule."
          />
        </div>
      ) : type === "staff" ? (
        <StaffMode userId={id} anchor={anchor} view={view} />
      ) : (
        <DepartmentMode actor={actor} departmentId={id} anchor={anchor} view={view} />
      )}
    </div>
  );
}

async function StaffMode({ userId, anchor, view }: { userId: string; anchor: Date; view: ScheduleView }) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true },
  });
  if (!user || user.role !== "STAFF") notFound();

  const { rangeStart, rangeEnd } = resolveScheduleRange(view, anchor);
  const shifts = await db.shift.findMany({
    where: { assignedWorkerId: user.id, startsAt: { gte: rangeStart, lt: rangeEnd } },
    include: { department: { select: { name: true, code: true } } },
    orderBy: { startsAt: "asc" },
  });

  return (
    <PersonalScheduleCalendar
      title={`${user.name}'s Schedule`}
      subtitle="Personal calendar - the same view staff see for themselves at /worker/schedule."
      shifts={shifts}
      anchor={anchor}
      view={view}
      hrefFor={(d, v) => scheduleHref({ type: "staff", id: user.id }, d, v)}
    />
  );
}

async function DepartmentMode({
  actor,
  departmentId,
  anchor,
  view,
}: {
  actor: Actor;
  departmentId: string;
  anchor: Date;
  view: ScheduleView;
}) {
  const { rangeStart, rangeEnd, weekStart, weekEnd, weekDays, monthStart, monthEnd, prevDate, nextDate } =
    resolveScheduleRange(view, anchor);

  const days = view === "day" ? [anchor] : view === "week" ? weekDays : eachDayOfInterval({ start: monthStart, end: monthEnd });

  const result = await loadLocationSchedule(actor, departmentId, { gte: rangeStart, lt: rangeEnd }, days);
  if (!result) notFound();

  const Icon = getDepartmentIcon(result.department.iconKey);
  const hrefFor = (d: Date, v: ScheduleView) => scheduleHref({ type: "department", id: departmentId }, d, v);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-lg bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-primary-700" aria-hidden />
        </div>
        <div>
          <h2 className="text-xl font-bold text-neutral-900">{result.department.name}</h2>
          <p className="text-xs text-neutral-500 uppercase tracking-wide">
            {result.department.code}
            {result.department.wing ? ` · ${result.department.wing}` : ""}
          </p>
        </div>
      </div>

      <CalendarNav
        heading={primaryScheduleHeading(anchor, view, weekStart, weekEnd)}
        anchor={anchor}
        view={view}
        prevDate={prevDate}
        nextDate={nextDate}
        hrefFor={hrefFor}
      />

      {view === "month" ? (
        <LocationScheduleMonthHeatmap
          days={days}
          rows={result.rows}
          dayHref={(d) => scheduleHref({ type: "department", id: departmentId }, d, "day")}
        />
      ) : (
        <LocationScheduleGrid days={days} rows={result.rows} linkHref={(shift) => `/admin/shifts/${shift.id}`} />
      )}
    </div>
  );
}
