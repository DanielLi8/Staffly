"use client";

import { useState, useTransition } from "react";
import { ChevronsRight, Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { advanceTier, holdCallout, resumeCallout, stopCallout } from "@/app/actions/callout";
import type { CampaignStatus } from "@prisma/client";

interface CascadeControlsProps {
  shiftId: string;
  status: CampaignStatus;
  currentTier: number;
  maxTier: number;
}

/**
 * Advance / hold / stop outreach, for a callout that is still running or on
 * hold (the dashboard explains an ended one instead). These are plain database
 * writes behind the scenes, so they work identically with and without Inngest -
 * the demo can steer the whole cascade by hand.
 *
 * "Stop outreach" ends texts only. Bidding is gated by the shift, not
 * the campaign, so the shift keeps taking bids until it is awarded or cancelled.
 */
export function CascadeControls({ shiftId, status, currentTier, maxTier }: CascadeControlsProps) {
  const [error, setError] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<void>) {
    setError("");
    startTransition(async () => {
      try {
        await action();
        setConfirmStop(false);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Action failed.");
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <div
          role="alert"
          className="px-4 py-3 bg-accent-50 border border-accent-200 rounded-md text-sm text-accent-700"
        >
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => run(() => advanceTier(shiftId))}
          disabled={isPending}
        >
          <ChevronsRight className="w-4 h-4" aria-hidden="true" />
          {currentTier >= maxTier ? "Close as exhausted" : `Advance to tier ${currentTier + 1}`}
        </Button>

        {status === "PAUSED" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => run(() => resumeCallout(shiftId))}
            disabled={isPending}
          >
            <Play className="w-4 h-4" aria-hidden="true" />
            Resume
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => run(() => holdCallout(shiftId))}
            disabled={isPending}
          >
            <Pause className="w-4 h-4" aria-hidden="true" />
            Hold
          </Button>
        )}

        {confirmStop ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-600">
              Stop texting? Bidding stays open in the app and by reply.
            </span>
            <Button
              size="sm"
              variant="danger"
              onClick={() => run(() => stopCallout(shiftId))}
              loading={isPending}
            >
              Stop outreach
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmStop(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmStop(true)}
            disabled={isPending}
            className="text-accent-700 border-accent-200 hover:bg-accent-50"
          >
            <Square className="w-4 h-4" aria-hidden="true" />
            Stop outreach
          </Button>
        )}
      </div>

      <p className="text-xs text-neutral-500">
        Stopping outreach ends texts only. Staff can still bid - in the app or by
        replying to a text they already got - until the shift is awarded, cancelled,
        or over.
      </p>
    </div>
  );
}
