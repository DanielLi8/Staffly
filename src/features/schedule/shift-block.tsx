import Link from "next/link";
import { hospitalTime } from "@/lib/timezone";
import { cn } from "@/lib/utils";

/**
 * Split out of `personal-schedule-calendar.tsx` so the availability editor's
 * client-side month grid (`src/features/availability/availability-month-grid.tsx`)
 * can render the same shift blocks without a circular import between the two
 * (that grid renders inside `PersonalScheduleCalendar`'s month view, so the
 * dependency can only run one way).
 */
export interface PersonalScheduleShift {
  id: string;
  startsAt: Date;
  endsAt: Date;
  department: { name: string; code: string };
  roleNeeded: string;
}

export function ShiftBlock({ shift, compact, href }: { shift: PersonalScheduleShift; compact?: boolean; href?: string }) {
  const done = shift.endsAt < new Date();
  const confirmed = shift.startsAt <= new Date() && shift.endsAt >= new Date();
  const className = cn(
    "rounded-md border text-left w-full",
    compact ? "p-1 sm:p-1.5 text-[9px] sm:text-[10px]" : "rounded-lg p-2 text-[11px]",
    done && "bg-neutral-100 border-neutral-200 text-neutral-700",
    confirmed && "bg-primary-700 border-primary-800 text-white",
    !done && !confirmed && "bg-white border-neutral-200 text-neutral-800",
    href && "block hover:ring-1 hover:ring-primary-300 transition-shadow"
  );
  const body = (
    <>
      <p className="font-bold uppercase tracking-wide opacity-80 leading-tight">
        {done ? "Done" : confirmed ? "Now" : "Assigned"}
      </p>
      <p className={cn("font-semibold mt-0.5 leading-tight", compact && "line-clamp-2")}>{shift.department.name}</p>
      {!compact && <p className="opacity-90">{shift.roleNeeded}</p>}
      <p className="mt-0.5 opacity-90 tabular-nums">
        {hospitalTime(shift.startsAt, false)}–{hospitalTime(shift.endsAt, false)}
      </p>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}
