import Link from "next/link";
import { format } from "date-fns";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { hospitalDate } from "@/lib/timezone";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import type { GridShift, LocationScheduleRow } from "@/lib/location-schedule/grid";
import { ScrollAreaX } from "@/components/ui/scroll-area-x";
import { ShiftCell } from "./shift-cell";

const NO_ROSTER = (
  <EmptyState
    icon={Users}
    title="No roster members"
    description="No staff are assigned to this department yet."
  />
);

/**
 * The day/week Location Schedule grid: roster rows down the left, day
 * columns across the top, one `<ShiftCell>` per intersection. `linkHref` is
 * only passed for actors allowed to reach the shift detail page (ADMIN) -
 * everyone else gets plain, non-linking cells.
 */
export function LocationScheduleGrid({
  days,
  rows,
  linkHref,
}: {
  days: Date[];
  rows: LocationScheduleRow[];
  linkHref?: (shift: GridShift) => string;
}) {
  if (rows.length === 0) return <div className="card-base">{NO_ROSTER}</div>;

  return (
    // Staff column narrows (and drops the avatar) below `sm` so a phone shows
    // more than one day column beside it; day columns scroll sideways.
    <ScrollAreaX
      label="Department schedule"
      className="card-base overflow-hidden [--staff-col:136px] [--day-col:124px] sm:[--staff-col:200px]"
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: `var(--staff-col) repeat(${days.length}, minmax(var(--day-col), 1fr))` }}
      >
        <div className="sticky left-0 z-10 bg-neutral-50 border-b border-r border-neutral-200 px-3 py-2 text-xs font-bold text-neutral-500 uppercase">
          Staff
        </div>
        {days.map((d) => (
          <div
            key={d.toISOString()}
            className="border-b border-neutral-200 bg-neutral-50/80 px-2 py-2 text-center"
          >
            <p className="text-[10px] font-bold text-neutral-500 uppercase">{format(d, "EEE")}</p>
            <p className="text-sm font-semibold text-neutral-900 tabular-nums">{format(d, "MMM d")}</p>
          </div>
        ))}

        {rows.map((row) => (
          <GridRow key={row.member.userId} row={row} days={days} linkHref={linkHref} />
        ))}
      </div>
    </ScrollAreaX>
  );
}

function GridRow({
  row,
  days,
  linkHref,
}: {
  row: LocationScheduleRow;
  days: Date[];
  linkHref?: (shift: GridShift) => string;
}) {
  return (
    <>
      <div className="sticky left-0 z-10 bg-white border-r border-b border-neutral-100 px-3 py-2 flex items-center gap-2 min-w-0">
        <Avatar name={row.member.name} src={row.member.image} size="sm" className="hidden sm:inline-flex" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-neutral-900 truncate">{row.member.name}</p>
          <p className="text-[11px] text-neutral-500 truncate">{row.member.title}</p>
        </div>
      </div>
      {days.map((d) => {
        const key = hospitalDate(d);
        return (
          <div key={key} className="border-r border-b border-neutral-100 last:border-r-0">
            <ShiftCell shifts={row.cellsByDay.get(key) ?? []} linkHref={linkHref} />
          </div>
        );
      })}
    </>
  );
}

/**
 * The month view for a multi-person roster: a literal 30-rows x 30-columns
 * table of full shift labels is unusable, so month renders a denser
 * per-day shift-count heatmap instead - narrow columns (one per day of the
 * month, horizontally scrollable) showing just a count badge, which links
 * through to the day view for that date so a scheduler can drill in. 0
 * shifts renders a subtle dash; 2+ shifts get the same warning tint used by
 * the day/week `ShiftCell` to flag a likely double-booking.
 */
export function LocationScheduleMonthHeatmap({
  days,
  rows,
  dayHref,
}: {
  days: Date[];
  rows: LocationScheduleRow[];
  dayHref: (date: Date) => string;
}) {
  if (rows.length === 0) return <div className="card-base">{NO_ROSTER}</div>;

  return (
    <ScrollAreaX
      label="Department month schedule"
      className="card-base overflow-hidden [--staff-col:136px] sm:[--staff-col:180px]"
    >
      <div
        className="grid min-w-max"
        style={{ gridTemplateColumns: `var(--staff-col) repeat(${days.length}, 32px)` }}
      >
        <div className="sticky left-0 z-10 bg-neutral-50 border-b border-r border-neutral-200 px-3 py-2 text-xs font-bold text-neutral-500 uppercase">
          Staff
        </div>
        {days.map((d) => (
          <div key={d.toISOString()} className="border-b border-neutral-200 bg-neutral-50/80 text-center py-2">
            <p className="text-[10px] font-semibold text-neutral-500 tabular-nums">{format(d, "d")}</p>
          </div>
        ))}

        {rows.map((row) => (
          <HeatmapRow key={row.member.userId} row={row} days={days} dayHref={dayHref} />
        ))}
      </div>
    </ScrollAreaX>
  );
}

function HeatmapRow({
  row,
  days,
  dayHref,
}: {
  row: LocationScheduleRow;
  days: Date[];
  dayHref: (date: Date) => string;
}) {
  return (
    <>
      <div className="sticky left-0 z-10 bg-white border-r border-b border-neutral-100 px-3 py-1.5 flex items-center gap-2 min-w-0">
        <Avatar name={row.member.name} src={row.member.image} size="sm" className="hidden sm:inline-flex" />
        <p className="text-sm font-medium text-neutral-900 truncate">{row.member.name}</p>
      </div>
      {days.map((d) => {
        const key = hospitalDate(d);
        const count = row.cellsByDay.get(key)?.length ?? 0;
        return (
          <div key={key} className="border-b border-neutral-100 flex items-center justify-center py-0.5">
            {count === 0 ? (
              <span className="text-neutral-200 text-xs" aria-hidden>
                &ndash;
              </span>
            ) : (
              <Link
                href={dayHref(d)}
                title={`${count} shift${count > 1 ? "s" : ""} on ${format(d, "MMM d")}`}
                aria-label={`${row.member.name}: ${count} shift${count > 1 ? "s" : ""} on ${format(d, "MMMM d")}`}
                className="group inline-flex h-8 w-8 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <span
                  className={cn(
                    "inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold transition-colors",
                    count > 1
                      ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300 group-hover:bg-amber-200"
                      : "bg-primary-100 text-primary-800 group-hover:bg-primary-200"
                  )}
                >
                  {count}
                </span>
              </Link>
            )}
          </div>
        );
      })}
    </>
  );
}
