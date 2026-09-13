"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatShiftRange, formatRelative } from "@/lib/utils";
import { hospitalMonthDay, hospitalWeekday } from "@/lib/timezone";
import {
  approveShiftSwapRequest,
  denyShiftSwapRequest,
  type PendingShiftSwapApproval,
} from "@/app/actions/shift-swap-approvals";

const KIND_LABEL = { SWAP: "Shift Swap", GIVEAWAY: "Shift Giveaway" } as const;

/**
 * Manager approve/deny queue: PENDING_APPROVAL requests the target colleague
 * has already accepted. Approving is the only action anywhere in the
 * pipeline that reassigns `Shift.assignedWorkerId`.
 */
export function AdminApprovalsList({ requests }: { requests: PendingShiftSwapApproval[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (requests.length === 0) {
    return <p className="text-sm text-neutral-500 py-4">No shift swap requests awaiting approval.</p>;
  }

  function handle(action: "approve" | "deny", id: string) {
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const result = await (action === "approve" ? approveShiftSwapRequest(id) : denyShiftSwapRequest(id));
      setPendingId(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="px-4 py-3 bg-accent-50 border border-accent-200 rounded-md text-sm text-accent-700">
          {error}
        </div>
      )}
      {requests.map((r) => {
        const disabled = isPending && pendingId === r.id;
        return (
          <div key={r.id} className="p-4 rounded-lg border border-neutral-200 bg-white space-y-2.5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <p className="text-sm font-semibold text-neutral-900">
                {KIND_LABEL[r.kind]}: {r.requesterName} → {r.targetName}
              </p>
              {r.respondedAt && (
                <span className="text-xs text-neutral-400">Accepted {formatRelative(r.respondedAt)}</span>
              )}
            </div>
            <div className="text-xs text-neutral-500 space-y-1">
              <p>
                {r.requesterName} gives up: {hospitalWeekday(r.giveShift.startsAt)}, {hospitalMonthDay(r.giveShift.startsAt)} ·{" "}
                {formatShiftRange(r.giveShift.startsAt, r.giveShift.endsAt)} · {r.giveShift.departmentName} ({r.giveShift.roleNeeded})
              </p>
              {r.receiveShift && (
                <p>
                  {r.targetName} gives up: {hospitalWeekday(r.receiveShift.startsAt)}, {hospitalMonthDay(r.receiveShift.startsAt)} ·{" "}
                  {formatShiftRange(r.receiveShift.startsAt, r.receiveShift.endsAt)}
                </p>
              )}
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" onClick={() => handle("approve", r.id)} disabled={disabled} loading={disabled}>
                Approve
              </Button>
              <Button size="sm" variant="danger" onClick={() => handle("deny", r.id)} disabled={disabled}>
                Deny
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
