import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { hospitalTime } from "@/lib/timezone";
import type { AvailabilityDTO } from "@/lib/availability/types";
import { ShiftBlock, type PersonalScheduleShift } from "@/features/schedule/shift-block";

const STATUS_LABELS: Record<AvailabilityDTO["status"], string> = {
  AVAILABLE: "Available",
  UNAVAILABLE: "Unavailable",
  TENTATIVE: "Tentative",
};

const STATUS_DOT_CLASSNAMES: Record<AvailabilityDTO["status"], string> = {
  AVAILABLE: "bg-emerald-400",
  UNAVAILABLE: "bg-accent-400",
  TENTATIVE: "bg-neutral-300",
};

/**
 * Read-only "what's on this day" view for `/worker/schedule`'s right panel -
 * rendered by `AvailabilityEditor` whenever `panelMode === "empty"`, in
 * place of the old static placeholder. Editing happens through the existing
 * Change Availability flow via `onEditAvailability`, never here.
 */
export function DayDetailsPanel({
  day,
  shifts,
  availability,
  onEditAvailability,
}: {
  day: Date;
  shifts: PersonalScheduleShift[];
  availability: AvailabilityDTO[];
  onEditAvailability: () => void;
}) {
  const sortedAvailability = [...availability].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const sortedShifts = [...shifts].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  return (
    <div className="card-base flex flex-col h-full min-h-[220px] md:min-h-[520px]">
      <div className="px-3 py-2.5 border-b border-neutral-200 bg-neutral-50/80 rounded-t-2xl">
        <p className="text-xs font-bold text-primary-800">Day details</p>
        <p className="text-sm font-semibold text-neutral-900 mt-0.5">{format(day, "EEEE, MMM d")}</p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3.5">
        <div>
          <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wide mb-1.5">Availability</p>
          {sortedAvailability.length === 0 ? (
            <p className="text-xs text-neutral-400">No availability set for this day.</p>
          ) : (
            <div className="space-y-1">
              {sortedAvailability.map((a) => (
                <div key={a.id} className="flex items-center gap-1.5 text-xs text-neutral-700">
                  <span className={cn("h-2 w-2 rounded-full shrink-0", STATUS_DOT_CLASSNAMES[a.status])} />
                  {STATUS_LABELS[a.status]} · {hospitalTime(a.startsAt)}–{hospitalTime(a.endsAt)}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wide mb-1.5">Scheduled shifts</p>
          {sortedShifts.length === 0 ? (
            <p className="text-xs text-neutral-400">No shifts assigned.</p>
          ) : (
            <div className="space-y-1.5">
              {sortedShifts.map((s) => (
                <ShiftBlock key={s.id} shift={s} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-auto p-3 border-t border-dashed border-neutral-200">
        <button
          type="button"
          onClick={onEditAvailability}
          className="w-full h-9 rounded-md bg-primary-700 text-white text-sm font-semibold hover:bg-primary-800"
        >
          Edit availability
        </button>
      </div>
    </div>
  );
}
