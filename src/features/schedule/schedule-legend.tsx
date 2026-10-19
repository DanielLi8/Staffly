import { cn } from "@/lib/utils";

/**
 * Key for the schedule color language. `showAvailability` is off when a page
 * draws shifts only (no availability passed to the grid).
 */
export function ScheduleLegend({
  showAvailability = true,
  showNow = true,
  shiftLabel = "Your shift",
  className,
}: {
  showAvailability?: boolean;
  /** Month view has no time axis, so no "now" line. */
  showNow?: boolean;
  /** "Shift" when viewing someone else's schedule. */
  shiftLabel?: string;
  className?: string;
}) {
  const swatch = "inline-block h-3.5 w-3.5 shrink-0 rounded-sm border";
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-neutral-700", className)} aria-label="Legend">
      <li className="flex items-center gap-1.5">
        <span className={cn(swatch, "bg-primary-700 border-primary-800")} aria-hidden />
        {shiftLabel}
      </li>
      {showAvailability && (
        <>
          <li className="flex items-center gap-1.5">
            <span className={cn(swatch, "bg-emerald-100 border-emerald-300")} aria-hidden />
            Available
          </li>
          <li className="flex items-center gap-1.5">
            <span className={cn(swatch, "bg-unavailable-strong border-neutral-300")} aria-hidden />
            Not available
          </li>
          <li className="flex items-center gap-1.5">
            <span className={cn(swatch, "bg-white border-amber-400 ring-1 ring-amber-400")} aria-hidden />
            Outside availability
          </li>
          <li className="flex items-center gap-1.5">
            <span className={cn(swatch, "bg-white border-neutral-300")} aria-hidden />
            Not set
          </li>
        </>
      )}
      {showNow && (
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3.5 shrink-0 bg-primary-500" aria-hidden />
          Now
        </li>
      )}
    </ul>
  );
}
