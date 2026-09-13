"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatShiftRange } from "@/lib/utils";
import { hospitalMonthDay, hospitalWeekday } from "@/lib/timezone";
import { acceptShiftSwapRequest, rejectShiftSwapRequest, type IncomingShiftSwapRequest } from "@/app/actions/shift-swap";

const KIND_LABEL = { SWAP: "Shift Swap", GIVEAWAY: "Shift Giveaway" } as const;

/**
 * The targeted colleague's Accept/Reject surface for incoming Shift Swap /
 * Giveaway requests, shown on `/worker/schedule`. Accepting moves the
 * request to PENDING_APPROVAL (the manager's queue); rejecting is terminal.
 * Neither touches `Shift.assignedWorkerId` - only an admin's approval does.
 */
export function IncomingRequestsPanel({ requests }: { requests: IncomingShiftSwapRequest[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (requests.length === 0) return null;

  function handle(action: "accept" | "reject", id: string) {
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const result = await (action === "accept" ? acceptShiftSwapRequest(id) : rejectShiftSwapRequest(id));
      setPendingId(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card className="border-primary-200 bg-primary-50/40">
      <CardHeader>
        <CardTitle>
          Incoming Shift Requests ({requests.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div role="alert" className="px-3 py-2 bg-accent-50 border border-accent-200 rounded-md text-sm text-accent-700">
            {error}
          </div>
        )}
        {requests.map((r) => {
          const disabled = isPending && pendingId === r.id;
          return (
            <div key={r.id} className="flex items-start justify-between gap-3 p-3.5 rounded-lg border border-neutral-200 bg-white">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-neutral-800">
                  {r.requesterName} wants a {KIND_LABEL[r.kind]}
                </p>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Their shift: {hospitalWeekday(r.giveShift.startsAt)}, {hospitalMonthDay(r.giveShift.startsAt)} ·{" "}
                  {formatShiftRange(r.giveShift.startsAt, r.giveShift.endsAt)} · {r.giveShift.departmentName} ({r.giveShift.roleNeeded})
                </p>
                {r.receiveShift && (
                  <p className="text-xs text-neutral-500 mt-0.5">
                    In exchange for your shift: {hospitalWeekday(r.receiveShift.startsAt)}, {hospitalMonthDay(r.receiveShift.startsAt)} ·{" "}
                    {formatShiftRange(r.receiveShift.startsAt, r.receiveShift.endsAt)}
                  </p>
                )}
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                <Button size="sm" onClick={() => handle("accept", r.id)} disabled={disabled} loading={disabled}>
                  Accept
                </Button>
                <Button size="sm" variant="outline" onClick={() => handle("reject", r.id)} disabled={disabled}>
                  Reject
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
