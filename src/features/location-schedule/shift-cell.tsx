import Link from "next/link";
import { cn } from "@/lib/utils";
import { hospitalTime } from "@/lib/timezone";
import { classifyShiftType, type ShiftType } from "@/lib/shifts/shift-type";
import type { GridShift } from "@/lib/location-schedule/grid";

const TYPE_LABELS: Record<ShiftType, string> = { DAY: "Day", EVENING: "Evening", NIGHT: "Night" };

/**
 * The single seam for cell wording (per report Section 6) - 24-hour hospital
 * time, e.g. "Day 07:30-15:30".
 */
export function formatCellLabel(shift: Pick<GridShift, "startsAt" | "endsAt">): string {
  const type = TYPE_LABELS[classifyShiftType(shift.startsAt)];
  return `${type} ${hospitalTime(shift.startsAt, false)}-${hospitalTime(shift.endsAt, false)}`;
}

/**
 * One day-column x roster-row cell for the day/week grid: 0 shifts renders a
 * subtle dash, 1 a single label line, 2+ stack with a warning tint - two
 * shifts assigned to one person on one day is very likely a scheduling
 * mistake worth noticing, not just rendering. `linkHref` is only passed for
 * an actor allowed to reach the shift detail page (ADMIN); everyone else
 * gets plain, non-linking text.
 */
export function ShiftCell({
  shifts,
  linkHref,
}: {
  shifts: GridShift[];
  linkHref?: (shift: GridShift) => string;
}) {
  if (shifts.length === 0) {
    return (
      <div className="h-full min-h-[52px] flex items-center justify-center text-neutral-300" aria-hidden>
        &ndash;
      </div>
    );
  }

  const multiple = shifts.length > 1;

  return (
    <div
      className={cn(
        "h-full min-h-[52px] p-1 space-y-1",
        multiple && "bg-amber-50/70 ring-1 ring-inset ring-amber-200 rounded-md"
      )}
    >
      {shifts.map((shift) => (
        <ShiftChip key={shift.id} shift={shift} href={linkHref?.(shift)} />
      ))}
    </div>
  );
}

function ShiftChip({ shift, href }: { shift: GridShift; href?: string }) {
  const className = "block rounded-md border px-1.5 py-1 text-[11px] leading-tight bg-white border-neutral-200 text-neutral-800";
  const body = (
    <>
      <p className="font-semibold truncate">{formatCellLabel(shift)}</p>
      <p className="text-neutral-500 truncate">Unit {shift.unit}</p>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={cn(className, "hover:ring-1 hover:ring-primary-300 transition-shadow")}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}
