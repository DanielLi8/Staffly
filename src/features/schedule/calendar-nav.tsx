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
export function CalendarNav({
  heading,
  anchor,
  view,
  prevDate,
  nextDate,
  today = new Date(),
  hrefFor,
}: {
  heading: string;
  anchor: Date;
  view: ScheduleView;
  prevDate: Date;
  nextDate: Date;
  today?: Date;
  hrefFor: (date: Date, view: ScheduleView) => string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-2xl font-semibold text-neutral-900 tracking-tight">{heading}</h2>
      </div>

      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
        <div className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-1 py-1 self-start">
          <Link
            href={hrefFor(prevDate, view)}
            className="p-2 rounded-full hover:bg-neutral-100 text-neutral-700"
            aria-label={view === "month" ? "Previous month" : view === "week" ? "Previous week" : "Previous day"}
          >
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <Link
            href={hrefFor(nextDate, view)}
            className="p-2 rounded-full hover:bg-neutral-100 text-neutral-700"
            aria-label={view === "month" ? "Next month" : view === "week" ? "Next week" : "Next day"}
          >
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        <Link
          href={hrefFor(today, view)}
          className="h-10 px-4 inline-flex items-center justify-center rounded-full border border-neutral-200 bg-white text-sm font-medium text-neutral-800 hover:bg-neutral-50 self-start"
        >
          Today
        </Link>

        <div
          className="inline-flex rounded-full border border-neutral-200 p-0.5 bg-neutral-100 gap-0.5 self-start max-w-full overflow-x-auto"
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
              className={cn(
                "px-3 sm:px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors",
                view === v ? "bg-white text-primary-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"
              )}
            >
              {label}
            </Link>
          ))}
        </div>
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
