"use client";

import { useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/utils";
import { assignWorker } from "@/app/actions/shifts";
import { CheckCircle } from "lucide-react";
import type { BidWithWorker } from "@/types";

interface BidderListProps {
  shiftId: string;
  bids: BidWithWorker[];
  shiftOpen: boolean;
}

export function BidderList({ shiftId, bids, shiftOpen }: BidderListProps) {
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (bids.length === 0) {
    return (
      <p className="text-sm text-neutral-500 py-4">
        No bids have been submitted yet.
      </p>
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
        await assignWorker(shiftId, workerId);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to assign worker.");
        setConfirmId(null);
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="px-4 py-3 bg-accent-50 border border-accent-200 rounded-md text-sm text-accent-700">
          {error}
        </div>
      )}

      {bids.map((bid) => (
        <div
          key={bid.id}
          className="flex items-start gap-3 p-4 rounded-lg border border-neutral-200 bg-white hover:border-neutral-300 transition-colors"
        >
          <Avatar name={bid.worker.name} size="md" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-neutral-900 text-sm">{bid.worker.name}</span>
              {bid.status === "SELECTED" && (
                <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                  <CheckCircle className="w-3 h-3" aria-hidden="true" />
                  Assigned
                </span>
              )}
              {bid.status === "NOT_SELECTED" && (
                <Badge className="border-neutral-200 text-neutral-500 bg-neutral-50">Not selected</Badge>
              )}
            </div>
            <p className="text-xs text-neutral-500 mt-0.5">
              {bid.worker.position} · {bid.worker.department}
            </p>
            {bid.note && (
              <p className="text-sm text-neutral-700 mt-2 italic leading-relaxed">
                &ldquo;{bid.note}&rdquo;
              </p>
            )}
            <p className="text-xs text-neutral-400 mt-2">
              Bid submitted {formatRelative(bid.createdAt)}
            </p>
          </div>

          {shiftOpen && bid.status === "PENDING" && (
            <div className="flex-shrink-0">
              {confirmId === bid.worker.id ? (
                <div className="flex flex-col gap-1.5 items-end">
                  <p className="text-xs text-neutral-500 text-right">Confirm selection?</p>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      onClick={() => handleAssign(bid.worker.id)}
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
                  onClick={() => handleAssign(bid.worker.id)}
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
  );
}
