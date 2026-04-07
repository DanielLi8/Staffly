"use client";

import { useMemo, useState, useTransition } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { placeBid, withdrawBid } from "@/app/actions/bids";
import type { BidStatus } from "@/types";
import { cn } from "@/lib/utils";

function toDatetimeLocalValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLocalToIso(local: string): string {
  const t = new Date(local).getTime();
  if (Number.isNaN(t)) throw new Error("Invalid time");
  return new Date(t).toISOString();
}

interface BidFormProps {
  shiftId: string;
  shiftStartsAtIso: string;
  shiftEndsAtIso: string;
  existingBid?: {
    status: BidStatus;
    note?: string | null;
    durationScope?: "FULL" | "PARTIAL";
    partialStartsAt?: Date | string | null;
    partialEndsAt?: Date | string | null;
  } | null;
  shiftOpen: boolean;
  deadlinePassed: boolean;
}

export function BidForm({
  shiftId,
  shiftStartsAtIso,
  shiftEndsAtIso,
  existingBid,
  shiftOpen,
  deadlinePassed,
}: BidFormProps) {
  const shiftStart = useMemo(() => new Date(shiftStartsAtIso), [shiftStartsAtIso]);
  const shiftEnd = useMemo(() => new Date(shiftEndsAtIso), [shiftEndsAtIso]);

  const [started, setStarted] = useState(!!existingBid);
  const [durationScope, setDurationScope] = useState<"FULL" | "PARTIAL">(
    existingBid?.durationScope === "PARTIAL" ? "PARTIAL" : "FULL"
  );
  const [partialStart, setPartialStart] = useState(() => {
    if (existingBid?.partialStartsAt) {
      return toDatetimeLocalValue(new Date(existingBid.partialStartsAt));
    }
    return toDatetimeLocalValue(shiftStart);
  });
  const [partialEnd, setPartialEnd] = useState(() => {
    if (existingBid?.partialEndsAt) {
      return toDatetimeLocalValue(new Date(existingBid.partialEndsAt));
    }
    return toDatetimeLocalValue(shiftEnd);
  });

  const [note, setNote] = useState(existingBid?.note ?? "");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isPending, startTransition] = useTransition();

  const minLocal = toDatetimeLocalValue(shiftStart);
  const maxLocal = toDatetimeLocalValue(shiftEnd);

  if (!shiftOpen) {
    return (
      <div className="px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-md text-sm text-neutral-500">
        This shift is no longer accepting bids.
      </div>
    );
  }

  if (deadlinePassed) {
    return (
      <div className="px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-md text-sm text-neutral-500">
        The bid deadline has passed.
      </div>
    );
  }

  if (existingBid && existingBid.status !== "PENDING") {
    return (
      <div className="px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-md text-sm text-neutral-600">
        Your bid has been processed. No further action is needed.
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    startTransition(async () => {
      try {
        await placeBid({
          shiftId,
          note: note.trim() || undefined,
          durationScope,
          partialStartsAt:
            durationScope === "PARTIAL" ? parseLocalToIso(partialStart) : undefined,
          partialEndsAt: durationScope === "PARTIAL" ? parseLocalToIso(partialEnd) : undefined,
        });
        setSuccess("Your bid was submitted. You will be notified if you are selected.");
        setStarted(true);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to submit bid.");
      }
    });
  }

  async function handleWithdraw() {
    setError("");
    startTransition(async () => {
      try {
        await withdrawBid(shiftId);
        setNote("");
        setSuccess("Your bid has been withdrawn.");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to withdraw bid.");
      }
    });
  }

  if (!existingBid && !started) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-neutral-600 leading-relaxed">
          Ready to bid? You&apos;ll choose whether you want the full posted shift or a portion of it, then add an
          optional note for the staffing coordinator.
        </p>
        <Button type="button" className="w-full sm:w-auto" onClick={() => setStarted(true)}>
          Bid for Shift
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div role="alert" className="px-4 py-3 bg-accent-50 border border-accent-200 rounded-md text-sm text-accent-700">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="px-4 py-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-700">
          {success}
        </div>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-3">Step 1 — Duration</p>
        <fieldset className="space-y-3">
          <legend className="sr-only">Bid duration</legend>
          <label
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
              durationScope === "FULL" ? "border-primary-300 bg-primary-50/60" : "border-neutral-200 hover:border-neutral-300"
            )}
          >
            <input
              type="radio"
              name="duration"
              className="mt-1"
              checked={durationScope === "FULL"}
              onChange={() => setDurationScope("FULL")}
              disabled={isPending}
            />
            <span>
              <span className="font-medium text-neutral-900">Full shift</span>
              <span className="block text-xs text-neutral-500 mt-0.5">
                {format(shiftStart, "MMM d, h:mm a")} – {format(shiftEnd, "h:mm a")}
              </span>
            </span>
          </label>
          <label
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
              durationScope === "PARTIAL" ? "border-primary-300 bg-primary-50/60" : "border-neutral-200 hover:border-neutral-300"
            )}
          >
            <input
              type="radio"
              name="duration"
              className="mt-1"
              checked={durationScope === "PARTIAL"}
              onChange={() => setDurationScope("PARTIAL")}
              disabled={isPending}
            />
            <span>
              <span className="font-medium text-neutral-900">Partial shift</span>
              <span className="block text-xs text-neutral-500 mt-0.5">
                Bid for a window inside the posted hours (must stay within the shift times above).
              </span>
            </span>
          </label>
        </fieldset>
      </div>

      {durationScope === "PARTIAL" && (
        <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Your hours</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="partial-start" className="text-xs text-neutral-600">
                Start
              </Label>
              <input
                id="partial-start"
                type="datetime-local"
                min={minLocal}
                max={maxLocal}
                value={partialStart}
                onChange={(e) => setPartialStart(e.target.value)}
                disabled={isPending}
                className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <Label htmlFor="partial-end" className="text-xs text-neutral-600">
                End
              </Label>
              <input
                id="partial-end"
                type="datetime-local"
                min={minLocal}
                max={maxLocal}
                value={partialEnd}
                onChange={(e) => setPartialEnd(e.target.value)}
                disabled={isPending}
                className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm"
              />
            </div>
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">Step 2 — Note (optional)</p>
        <Label htmlFor="bid-note">Message to staffing coordinator</Label>
        <Textarea
          id="bid-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Experience, certifications, or context for your bid…"
          rows={3}
          maxLength={500}
          disabled={isPending}
          className="mt-1"
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 pt-1">
        {!existingBid ? (
          <Button type="submit" loading={isPending}>
            Submit bid
          </Button>
        ) : (
          <>
            <Button type="submit" loading={isPending}>
              Update bid
            </Button>
            <Button type="button" variant="outline" onClick={handleWithdraw} disabled={isPending}>
              Withdraw bid
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
