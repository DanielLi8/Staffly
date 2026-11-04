"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Toast, type ToastMessage } from "@/components/ui/toast";
import { cancelShift } from "@/app/actions/shifts";
import { useRouter } from "next/navigation";

/**
 * `version` is the `Shift.version` this page rendered: the cancel only lands if
 * nobody changed the shift since, otherwise the admin is told who did.
 *
 * A failure is shown as an error toast, not inline: the header column this
 * sits in is too narrow for a sentence on a phone, and the toast survives the
 * refresh that removes this button when another admin's change made the shift
 * no longer `cancellable` (the component stays mounted for that reason).
 */
export function CancelShiftButton({
  shiftId,
  version,
  cancellable,
}: {
  shiftId: string;
  version: number;
  cancellable: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setToast(null);
    startTransition(async () => {
      try {
        const result = await cancelShift(shiftId, version);
        if (result.ok) {
          router.back();
          return;
        }
        setToast({ id: Date.now(), message: result.error, tone: "error" });
        setConfirm(false);
        router.refresh();
      } catch (err: unknown) {
        setToast({
          id: Date.now(),
          message: err instanceof Error ? err.message : "Failed to cancel shift.",
          tone: "error",
        });
        setConfirm(false);
      }
    });
  }

  const toastEl = <Toast toast={toast} onDismiss={() => setToast(null)} />;

  if (!cancellable) return toastEl;

  return (
    <div className="flex flex-col items-end gap-1">
      {toastEl}
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
