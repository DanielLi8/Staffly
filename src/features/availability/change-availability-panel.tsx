"use client";

import { format } from "date-fns";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseTimeInput } from "@/lib/shifts/time";

export interface BlockDraft {
  key: string;
  status: "AVAILABLE" | "UNAVAILABLE";
  from: string;
  to: string;
}

export function newBlockDraft(): BlockDraft {
  return { key: crypto.randomUUID(), status: "AVAILABLE", from: "7:00 AM", to: "3:00 PM" };
}

function formatSelectedDaysLabel(days: Date[]): string {
  if (days.length === 0) return "No days selected yet";
  if (days.length <= 3) return days.map((d) => format(d, "EEE, MMM d")).join(" · ");
  return `${days.length} days selected`;
}

/**
 * The right-side panel's "Change Availability" mode: the currently
 * selected day(s), a list of per-block Available/Unavailable + time-range
 * rows applied to every one of those days, and a Submit/Cancel row pinned
 * to the bottom of the panel regardless of how many blocks are in the list
 * (the block list scrolls internally; the button row does not).
 */
export function ChangeAvailabilityPanel({
  selectedDays,
  blocks,
  setBlocks,
  saving,
  onSubmit,
  onCancel,
}: {
  selectedDays: Date[];
  blocks: BlockDraft[];
  setBlocks: (update: (prev: BlockDraft[]) => BlockDraft[]) => void;
  saving: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  function updateBlock(key: string, patch: Partial<BlockDraft>) {
    setBlocks((prev) => prev.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  }

  function removeBlock(key: string) {
    setBlocks((prev) => prev.filter((b) => b.key !== key));
  }

  function addBlock() {
    setBlocks((prev) => [...prev, newBlockDraft()]);
  }

  const blocksValid =
    blocks.length > 0 && blocks.every((b) => parseTimeInput(b.from) && parseTimeInput(b.to));
  const canSubmit = selectedDays.length > 0 && blocksValid && !saving;

  return (
    <div className="card-base flex flex-col h-full min-h-[420px] lg:min-h-[520px]">
      <div className="px-3 py-2.5 border-b border-neutral-200 bg-neutral-50/80 rounded-t-2xl">
        <p className="text-xs font-bold text-primary-800">New Request &middot; Change Availability</p>
        <p className="text-xs text-neutral-500 mt-0.5">{formatSelectedDaysLabel(selectedDays)}</p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
        {blocks.map((block) => (
          <div key={block.key} className="relative rounded-lg border border-neutral-200 p-2.5">
            <button
              type="button"
              onClick={() => removeBlock(block.key)}
              aria-label="Remove block"
              className="absolute top-2 right-2 text-neutral-400 hover:text-neutral-600"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>

            <div className="flex rounded-md border border-neutral-200 overflow-hidden mb-2 text-xs font-semibold">
              <button
                type="button"
                onClick={() => updateBlock(block.key, { status: "AVAILABLE" })}
                className={cn(
                  "flex-1 py-1.5 text-center",
                  block.status === "AVAILABLE" ? "bg-emerald-600 text-white" : "text-neutral-500 hover:bg-neutral-50"
                )}
              >
                Available
              </button>
              <button
                type="button"
                onClick={() => updateBlock(block.key, { status: "UNAVAILABLE" })}
                className={cn(
                  "flex-1 py-1.5 text-center",
                  block.status === "UNAVAILABLE" ? "bg-accent text-white" : "text-neutral-500 hover:bg-neutral-50"
                )}
              >
                Unavailable
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={block.from}
                onChange={(e) => updateBlock(block.key, { from: e.target.value })}
                placeholder="7:00 AM"
                aria-label="Block start time"
                className={cn(
                  "min-w-0 flex-1 h-8 rounded-md border px-2 text-xs",
                  parseTimeInput(block.from) ? "border-neutral-300" : "border-accent-300"
                )}
              />
              <span className="text-neutral-400 text-xs">&ndash;</span>
              <input
                type="text"
                value={block.to}
                onChange={(e) => updateBlock(block.key, { to: e.target.value })}
                placeholder="3:00 PM"
                aria-label="Block end time"
                className={cn(
                  "min-w-0 flex-1 h-8 rounded-md border px-2 text-xs",
                  parseTimeInput(block.to) ? "border-neutral-300" : "border-accent-300"
                )}
              />
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addBlock}
          className="w-full rounded-md border border-dashed border-primary-300 text-primary-700 text-xs font-semibold py-2 hover:bg-primary-50"
        >
          + Block out another time slot
        </button>
      </div>

      <div className="mt-auto flex gap-2 p-3 border-t border-dashed border-neutral-200">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 h-9 rounded-md border border-neutral-300 text-neutral-600 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="flex-[2] h-9 rounded-md bg-primary-700 text-white text-sm font-semibold hover:bg-primary-800 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Submit"}
        </button>
      </div>
    </div>
  );
}
