import { format } from "date-fns";
import { dayKeyToLocalDate, hospitalDate } from "@/lib/timezone";
import { resolveScheduleDays, resolveScheduleRange, type ScheduleView } from "@/lib/schedule/range";
import type { AvailabilityDTO } from "@/lib/availability/types";
import { AvailabilityEditor } from "@/features/availability/availability-editor";
import { CalendarNavControls, primaryScheduleHeading } from "./calendar-nav";
import { ScheduleTimeGrid } from "./time-grid";
import { ScheduleMonthGrid } from "./month-grid";
import { ScheduleLegend } from "./schedule-legend";
import type { PersonalScheduleShift } from "./shift-block";

export type { PersonalScheduleShift };

/**
 * One person's schedule - day and week on a real 24-hour time grid, month as
 * a calendar of chips - with the date heading, prev/next/Today and the view
 * toggle on ONE header row. Shared by the STAFF self-service page and the
 * admin person view (`/admin/schedule?type=staff&id=...`): the caller fetches
 * `shifts` (and optionally `availability`) for `resolveScheduleDays(view,
 * anchor)` with an overlap query, and supplies `hrefFor` so this component
 * stays agnostic of its route.
 *
 * - `editable` (`/worker/schedule` only) hands the body to
 *   `AvailabilityEditor`: Day details panel, Set availability, + New Request.
 * - `shiftHrefBase` (admin) makes every shift a link to `${base}${shift.id}`;
 *   a plain string because a function can't cross into the client grid.
 * - `title` names whose schedule this is (admin); without it the date heading
 *   is the page's h1 (the top bar already says "Your Schedule").
 */
export function PersonalScheduleCalendar({
  title,
  shifts,
  availability,
  anchor,
  view,
  hrefFor,
  shiftHrefBase,
  editable = false,
}: {
  title?: string;
  shifts: PersonalScheduleShift[];
  availability?: AvailabilityDTO[];
  anchor: Date;
  view: ScheduleView;
  hrefFor: (date: Date, view: ScheduleView) => string;
  shiftHrefBase?: string;
  editable?: boolean;
}) {
  const { weekStart, weekEnd, prevDate, nextDate } = resolveScheduleRange(view, anchor);
  const { dayKeys } = resolveScheduleDays(view, anchor);
  const todayKey = hospitalDate(new Date());
  const anchorKey = format(anchor, "yyyy-MM-dd");
  const monthKey = format(anchor, "yyyy-MM");
  const dateHeading = primaryScheduleHeading(anchor, view, weekStart, weekEnd);

  const heading = title ? (
    <div className="min-w-0">
      <h2 className="section-title">{title}</h2>
      <p className="text-xl font-semibold tracking-tight text-neutral-900 sm:text-2xl">{dateHeading}</p>
    </div>
  ) : (
    <h1 className="text-xl font-semibold tracking-tight text-neutral-900 sm:text-2xl">
      <span className="sr-only">Your schedule, </span>
      {dateHeading}
    </h1>
  );
  const controls = (
    <CalendarNavControls
      anchor={anchor}
      view={view}
      prevDate={prevDate}
      nextDate={nextDate}
      today={dayKeyToLocalDate(todayKey)}
      hrefFor={hrefFor}
    />
  );

  if (editable) {
    return (
      <AvailabilityEditor
        key={`${view}-${dayKeys[0]}`}
        heading={heading}
        controls={controls}
        view={view}
        dayKeys={dayKeys}
        monthKey={monthKey}
        todayKey={todayKey}
        anchorKey={anchorKey}
        shifts={shifts}
        availability={availability ?? []}
      />
    );
  }

  const label = title ? `${title}, ${dateHeading}` : dateHeading;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {heading}
        {controls}
      </div>
      {view === "month" ? (
        <ScheduleMonthGrid
          dayKeys={dayKeys}
          monthKey={monthKey}
          todayKey={todayKey}
          shifts={shifts}
          availability={availability}
          shiftHrefBase={shiftHrefBase}
          label={label}
        />
      ) : (
        <ScheduleTimeGrid
          dayKeys={dayKeys}
          todayKey={todayKey}
          shifts={shifts}
          availability={availability}
          shiftHrefBase={shiftHrefBase}
          label={label}
        />
      )}
      <ScheduleLegend
        showAvailability={Boolean(availability)}
        showNow={view !== "month"}
        shiftLabel={title ? "Shift" : "Your shift"}
      />
    </div>
  );
}
