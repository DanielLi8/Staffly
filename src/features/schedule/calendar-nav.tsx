import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format, isSameMonth } from "date-fns";
import { cn } from "@/lib/utils";
import type { ScheduleView } from "@/lib/schedule/range";

/**
 * The prev/next/today pill + day/week/month toggle nav, shared by every
 * schedule surface (the personal calendar and the Location Schedule grid
 * alike) - copied verbatim from the pattern `worker/schedule/page.tsx`
 * originally built, just parameterized by `hrefFor` so callers can route to
 * any URL shape (e.g. `/admin/schedule?type=staff&id=...` vs `/worker/schedule?...`).
 */
export interface CalendarNavControlsProps {
  anchor: Date;
  view: ScheduleView;
  prevDate: Date;
  nextDate: Date;
  today?: Date;
  hrefFor: (date: Date, view: ScheduleView) => string;
}

export function CalendarNav({ heading, ...controls }: CalendarNavControlsProps & { heading: string }) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-2xl font-semibold text-neutral-900 tracking-tight">{heading}</h2>
      </div>
      <CalendarNavControls {...controls} />
    </div>
  );
}

/** Just the prev/next pill, Today and the view toggle - for callers that lay out their own heading row. */
export function CalendarNavControls({
  anchor,
  view,
  prevDate,
  nextDate,
  today = new Date(),
  hrefFor,
}: CalendarNavControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <div className="inline-flex items-center rounded-full border border-neutral-200 bg-white p-0.5">
        <Link
          href={hrefFor(prevDate, view)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-neutral-100 text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          aria-label={view === "month" ? "Previous month" : view === "week" ? "Previous week" : "Previous day"}
        >
          <ChevronLeft className="w-4 h-4" aria-hidden />
        </Link>
        <Link
          href={hrefFor(nextDate, view)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-neutral-100 text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          aria-label={view === "month" ? "Next month" : view === "week" ? "Next week" : "Next day"}
        >
          <ChevronRight className="w-4 h-4" aria-hidden />
        </Link>
      </div>

      <Link
        href={hrefFor(today, view)}
        className="h-10 px-3 sm:px-4 inline-flex items-center justify-center rounded-full border border-neutral-200 bg-white text-sm font-medium text-neutral-800 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        Today
      </Link>

      <div
        className="inline-flex rounded-full border border-neutral-200 p-0.5 bg-neutral-100 gap-0.5 max-w-full overflow-x-auto"
        role="group"
        aria-label="Calendar view"
      >
        {(
          [
            ["day", "Day"],
            ["week", "Week"],
            ["month", "Month"],
          ] as const
        ).map(([v, label]) => (
          <Link
            key={v}
            href={hrefFor(anchor, v)}
            aria-current={view === v ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center px-2.5 sm:px-4 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
              view === v ? "bg-white text-primary-900 shadow-sm" : "text-neutral-600 hover:text-neutral-800"
            )}
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function primaryScheduleHeading(anchor: Date, view: ScheduleView, weekStart: Date, weekEnd: Date): string {
  if (view === "day") return format(anchor, "EEEE, MMMM d, yyyy");
  if (view === "month") return format(anchor, "MMMM yyyy");
  if (isSameMonth(weekStart, weekEnd)) {
    return `${format(weekStart, "MMMM d")}–${format(weekEnd, "d, yyyy")}`;
  }
  return `${format(weekStart, "MMM d, yyyy")} – ${format(weekEnd, "MMM d, yyyy")}`;
}
