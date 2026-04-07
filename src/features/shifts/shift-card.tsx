import Link from "next/link";
import { Calendar, Clock, MapPin, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ShiftStatusBadge } from "@/components/ui/badge";
import { formatCalendarDay, formatShiftRange, formatRelative } from "@/lib/utils";
import { getDepartmentIcon } from "@/lib/department-icons";
import { cn } from "@/lib/utils";
import type { ShiftWithRelations } from "@/types";

const iconTints: Record<string, string> = {
  ER: "bg-rose-50 text-rose-700 border-rose-100",
  ICU: "bg-sky-50 text-sky-700 border-sky-100",
  MED: "bg-violet-50 text-violet-700 border-violet-100",
  PED: "bg-amber-50 text-amber-700 border-amber-100",
  SURG: "bg-teal-50 text-teal-700 border-teal-100",
  RAD: "bg-indigo-50 text-indigo-700 border-indigo-100",
};

interface ShiftCardProps {
  shift: ShiftWithRelations;
  href: string;
  showBidCount?: boolean;
  tone?: "default" | "muted";
}

export function ShiftCard({ shift, href, showBidCount = false, tone = "default" }: ShiftCardProps) {
  const DeptIcon = getDepartmentIcon(shift.department.iconKey);
  const tint = iconTints[shift.department.code] ?? "bg-primary-50 text-primary-800 border-primary-100";

  return (
    <Link href={href} className="block group">
      <Card
        className={cn(
          "rounded-xl border shadow-card transition-all hover:border-primary-200 hover:shadow-md",
          tone === "muted" && "bg-neutral-50/90 border-neutral-200/80"
        )}
      >
        <CardContent className="pt-4">
          <div className="flex gap-3 mb-3">
            <div
              className={cn(
                "w-11 h-11 rounded-lg flex items-center justify-center border shrink-0",
                tint
              )}
              aria-hidden
            >
              <DeptIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-neutral-900 group-hover:text-primary-700 transition-colors leading-tight">
                    {shift.department.name}
                  </h3>
                  <span className="inline-flex mt-1 rounded-full bg-sky-50 text-sky-800 border border-sky-100 px-2 py-0.5 text-[11px] font-medium">
                    {shift.roleNeeded}
                  </span>
                </div>
                <ShiftStatusBadge status={shift.status} />
              </div>

              <dl className="space-y-1.5 text-sm text-neutral-600 mt-2">
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" aria-hidden="true" />
                  <dt className="sr-only">Shift date</dt>
                  <dd>{formatCalendarDay(shift.startsAt)}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" aria-hidden="true" />
                  <dt className="sr-only">Shift time</dt>
                  <dd>{formatShiftRange(shift.startsAt, shift.endsAt)}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" aria-hidden="true" />
                  <dt className="sr-only">Location</dt>
                  <dd className="truncate">{shift.location}</dd>
                </div>
                {showBidCount && (
                  <div className="flex items-center gap-2">
                    <Users className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" aria-hidden="true" />
                    <dt className="sr-only">Responses</dt>
                    <dd>
                      {shift.bids.length === 0
                        ? "No responses yet"
                        : `${shift.bids.length} response${shift.bids.length !== 1 ? "s" : ""}`}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-400">
            <span>Respond by {formatRelative(shift.bidDeadlineAt)}</span>
            <span className="font-medium text-primary-600 group-hover:underline">
              View Details →
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
