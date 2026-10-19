"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatRelative } from "@/lib/utils";
import { assignWorker } from "@/app/actions/shifts";
import { CheckCircle, TimerReset } from "lucide-react";
import type { DashboardBidder } from "@/lib/callout/dashboard";

interface BidderListProps {
  shiftId: string;
  /** Already ordered most-senior-first - awarding is seniority-based. */
  bidders: DashboardBidder[];
  shiftOpen: boolean;
}

/** How long a bid that arrived while the page was open keeps its "New" pill. */
export const NEW_BID_PILL_MS = 60_000;

/**
 * Bids that arrived after this list first rendered (via a live refresh), each
 * with when it showed up, plus a screen-reader announcement of the latest
 * arrivals. Bids present at first render are never "new".
 */
function useArrivedBids(bidders: DashboardBidder[]) {
  const seenRef = useRef<Set<string> | null>(null);
  const [arrivedAt, setArrivedAt] = useState<Map<string, number>>(() => new Map());
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const seen = seenRef.current;
    if (!seen) {
      seenRef.current = new Set(bidders.map((b) => b.bidId));
      return;
    }
    const arrived = bidders.filter((b) => !seen.has(b.bidId));
    if (arrived.length === 0) return;
    arrived.forEach((b) => seen.add(b.bidId));
    const now = Date.now();
    setArrivedAt((prev) => {
      const next = new Map(prev);
      arrived.forEach((b) => next.set(b.bidId, now));
      return next;
    });
    setAnnouncement(
      arrived.length === 1
        ? `New bid from ${arrived[0].name}`
        : `New bids from ${arrived.map((b) => b.name).join(", ")}`
    );
  }, [bidders]);

  // Drop each pill once it has been up for NEW_BID_PILL_MS.
  useEffect(() => {
    if (arrivedAt.size === 0) return;
    const oldest = Math.min(...Array.from(arrivedAt.values()));
    const timer = setTimeout(
      () => {
        const cutoff = Date.now() - NEW_BID_PILL_MS;
        setArrivedAt((prev) => new Map(Array.from(prev).filter(([, at]) => at > cutoff)));
      },
      Math.max(0, oldest + NEW_BID_PILL_MS - Date.now())
    );
    return () => clearTimeout(timer);
  }, [arrivedAt]);

  return { isNew: (bidId: string) => arrivedAt.has(bidId), announcement };
}

export function BidderList({ shiftId, bidders, shiftOpen }: BidderListProps) {
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { isNew, announcement } = useArrivedBids(bidders);

  // Rendered in every state, empty included, and always as the first child of
  // the root fragment so React keeps the SAME node when the list goes from
  // empty to non-empty: a live region must already be in the DOM when its
  // text changes or screen readers may not announce it.
  const liveRegion = (
    <p role="status" className="sr-only">
      {announcement}
    </p>
  );

  if (bidders.length === 0) {
    return (
      <>
        {liveRegion}
        <p className="text-sm text-neutral-500 py-4">
          No bids have been submitted yet.
        </p>
      </>
    );
  }

  function handleAssign(workerId: string) {
    if (confirmId !== workerId) {
      setConfirmId(workerId);
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        const result = await assignWorker(shiftId, workerId);
        if (!result.ok) {
          setError(result.error);
          setConfirmId(null);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to assign worker.");
        setConfirmId(null);
      }
    });
  }

  return (
    <>
      {liveRegion}
      <div className="space-y-3">
        {error && (
          <div role="alert" className="px-4 py-3 bg-accent-50 border border-accent-200 rounded-md text-sm text-accent-700">
            {error}
          </div>
        )}

        <p className="text-xs text-neutral-500">
          Ranked by seniority. Overtime flags project this shift against the bidder&rsquo;s
          already-assigned hours for the same work week.
        </p>

        {bidders.map((bidder) => (
          <div
            key={bidder.bidId}
            className={cn(
              "flex items-start gap-3 p-4 rounded-lg border transition-colors motion-reduce:transition-none",
              isNew(bidder.bidId)
                ? "border-primary-200 bg-primary-50/40"
                : "border-neutral-200 bg-white hover:border-neutral-300"
            )}
          >
            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              <Avatar name={bidder.name} size="md" />
              <span className="pill-muted" title="Seniority rank among bidders">
                #{bidder.seniorityPosition}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-neutral-900 text-sm">{bidder.name}</span>
                {isNew(bidder.bidId) && (
                  <span className="inline-flex items-center rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider text-primary-800">
                    New
                  </span>
                )}
                {bidder.status === "SELECTED" && (
                  <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                    <CheckCircle className="w-3 h-3" aria-hidden="true" />
                    Assigned
                  </span>
                )}
                {bidder.status === "NOT_SELECTED" && (
                  <Badge className="border-neutral-200 text-neutral-500 bg-neutral-50">Not selected</Badge>
                )}
                {bidder.durationScope === "PARTIAL" && (
                  <Badge className="border-sky-200 text-sky-700 bg-sky-50">Partial</Badge>
                )}
                {bidder.overtime.isOvertime && (
                  <span
                    className="inline-flex items-center gap-1 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"
                    title={`Projected ${bidder.overtime.projectedHours}h this week against a ${bidder.overtime.thresholdHours}h threshold`}
                  >
                    <TimerReset className="w-3 h-3" aria-hidden="true" />
                    OT +{formatHours(bidder.overtime.overtimeHours)}
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-500 mt-0.5">
                {bidder.position} · {bidder.department}
              </p>
              <p className="text-xs text-neutral-500 mt-1">
                Week projection: {formatHours(bidder.overtime.assignedHours)} assigned +{" "}
                {formatHours(bidder.overtime.shiftHours)} this shift ={" "}
                <span className={bidder.overtime.isOvertime ? "text-amber-700 font-semibold" : ""}>
                  {formatHours(bidder.overtime.projectedHours)}
                </span>{" "}
                / {formatHours(bidder.overtime.thresholdHours)}
              </p>
              {bidder.note && (
                <p className="text-sm text-neutral-700 mt-2 italic leading-relaxed">
                  &ldquo;{bidder.note}&rdquo;
                </p>
              )}
              <p className="text-xs text-neutral-500 mt-2">
                Bid submitted {formatRelative(bidder.createdAt)}
              </p>
            </div>

            {shiftOpen && bidder.status === "PENDING" && (
              <div className="flex-shrink-0">
                {confirmId === bidder.workerId ? (
                  <div className="flex flex-col gap-1.5 items-end">
                    <p className="text-xs text-neutral-500 text-right">Confirm selection?</p>
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        onClick={() => handleAssign(bidder.workerId)}
                        loading={isPending}
                      >
                        Confirm
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmId(null)}
                        disabled={isPending}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAssign(bidder.workerId)}
                    disabled={isPending}
                  >
                    Select
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/** Trim trailing zeros so "8h" beats "8.0h" but "7.5h" survives. */
function formatHours(hours: number): string {
  return `${Number(hours.toFixed(2))}h`;
}
