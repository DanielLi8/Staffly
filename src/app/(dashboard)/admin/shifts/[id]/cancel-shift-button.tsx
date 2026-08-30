"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cancelShift } from "@/app/actions/shifts";
import { useRouter } from "next/navigation";

export function CancelShiftButton({ shiftId }: { shiftId: string }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        await cancelShift(shiftId);
        router.back();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to cancel shift.");
        setConfirm(false);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {error && <p className="text-xs text-accent">{error}</p>}
      {confirm ? (
        <div className="flex items-center gap-2">
          <p className="text-sm text-neutral-600">Are you sure?</p>
          <Button size="sm" variant="danger" onClick={handleClick} loading={isPending}>
            Yes, Cancel
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirm(false)} disabled={isPending}>
            No
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={handleClick}>
          Cancel Shift
        </Button>
      )}
    </div>
  );
}
