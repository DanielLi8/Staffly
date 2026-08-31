"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cn, formatShiftRange } from "@/lib/utils";
import { hospitalMonthDay, hospitalWeekday } from "@/lib/timezone";
import { payPeriodFor } from "@/lib/shift-swap/pay-period";
import {
  createShiftSwapRequest,
  listMyGiveableShifts,
  listUnitGiveawayCandidates,
  listUnitSwapCandidates,
  type GiveableShift,
  type GiveawayCandidateEntry,
  type SwapCandidateEntry,
} from "@/app/actions/shift-swap";
import type { ShiftSwapKind } from "./types";

const KIND_LABEL: Record<ShiftSwapKind, string> = { SWAP: "Shift Swap", GIVEAWAY: "Shift Giveaway" };

type Step = 1 | 2 | 3;

/**
 * The 3-step requester-side flow from the captain-approved mockup: pick your
 * shift, pick who/what you receive it for, confirm & send. Submitting only
 * creates a `ShiftSwapRequest` in PENDING_ACCEPT (see
 * `src/app/actions/shift-swap.ts`) - it never touches `Shift.assignedWorkerId`.
 */
export function ShiftSwapPanel({ kind, onClose }: { kind: ShiftSwapKind; onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);

  const [giveShifts, setGiveShifts] = useState<GiveableShift[] | null>(null);
  const [giveShiftId, setGiveShiftId] = useState<string | null>(null);

  const [swapCandidates, setSwapCandidates] = useState<SwapCandidateEntry[] | null>(null);
  const [giveawayCandidates, setGiveawayCandidates] = useState<GiveawayCandidateEntry[] | null>(null);
  const [search, setSearch] = useState("");

  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  const [targetUserName, setTargetUserName] = useState<string | null>(null);
  const [receiveShiftId, setReceiveShiftId] = useState<string | null>(null);
  const [receiveShiftRange, setReceiveShiftRange] = useState<{ startsAt: Date; endsAt: Date } | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const giveShift = useMemo(() => giveShifts?.find((s) => s.id === giveShiftId) ?? null, [giveShifts, giveShiftId]);
  const period = giveShift ? payPeriodFor(giveShift.startsAt) : payPeriodFor(new Date());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listMyGiveableShifts()
      .then((shifts) => {
        if (!cancelled) setGiveShifts(shifts);
      })
      .catch(() => !cancelled && setError("Couldn't load your shifts. Please try again."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadStep2(shiftId: string) {
    setLoading(true);
    setError(null);
    setTargetUserId(null);
    setTargetUserName(null);
    setReceiveShiftId(null);
    setReceiveShiftRange(null);

    const request =
      kind === "SWAP" ? listUnitSwapCandidates(shiftId) : listUnitGiveawayCandidates(shiftId, "");

    request
      .then((result) => {
        if (kind === "SWAP") setSwapCandidates(result as SwapCandidateEntry[]);
        else setGiveawayCandidates(result as GiveawayCandidateEntry[]);
      })
      .catch(() => setError("Couldn't load your unit's roster. Please try again."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (kind !== "GIVEAWAY" || step !== 2 || !giveShiftId) return;
    const handle = setTimeout(() => {
      setLoading(true);
      listUnitGiveawayCandidates(giveShiftId, search)
        .then((result) => setGiveawayCandidates(result))
        .catch(() => setError("Couldn't search your unit's roster. Please try again."))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function goToStep2() {
    if (!giveShiftId) return;
    setStep(2);
    loadStep2(giveShiftId);
  }

  function pickSwapCandidate(row: SwapCandidateEntry) {
    if (!row.eligible) return;
    setTargetUserId(row.userId);
    setTargetUserName(row.userName);
    setReceiveShiftId(row.shiftId);
    setReceiveShiftRange({ startsAt: row.startsAt, endsAt: row.endsAt });
    setStep(3);
  }

  function pickGiveawayCandidate(row: GiveawayCandidateEntry) {
    if (!row.eligible) return;
    setTargetUserId(row.userId);
    setTargetUserName(row.userName);
    setStep(3);
  }

  async function handleSubmit() {
    if (!giveShiftId || !targetUserId) return;
    setLoading(true);
    setError(null);
    const result = await createShiftSwapRequest({
      giveShiftId,
      kind,
      targetUserId,
      receiveShiftId: kind === "SWAP" ? receiveShiftId ?? undefined : undefined,
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSubmitted(true);
    router.refresh();
  }

  const swapByDay = useMemo(() => {
    if (!swapCandidates) return [];
    const groups = new Map<string, SwapCandidateEntry[]>();
    for (const row of swapCandidates) {
      const key = hospitalMonthDay(row.startsAt);
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    return Array.from(groups.entries());
  }, [swapCandidates]);

  return (
    <div className="fixed inset-0 z-30 flex items-stretch justify-end">
      <div className="absolute inset-0 bg-neutral-900/40" onClick={onClose} aria-hidden />
      <div className="relative w-full sm:w-[420px] bg-white shadow-xl flex flex-col h-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-primary-500">Step {step} of 3</p>
            <h2 className="text-lg font-semibold text-primary-900">{KIND_LABEL[kind]}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-2 rounded-full hover:bg-neutral-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {error && (
            <div role="alert" className="px-3 py-2 bg-accent-50 border border-accent-200 rounded-lg text-sm text-accent-700">
              {error}
            </div>
          )}

          {step === 1 && (
            <>
              <p className="text-sm text-neutral-500">Only your own upcoming assigned shifts, this pay period.</p>
              <PayPeriodPill start={period.start} end={period.end} />
              {loading && <p className="text-sm text-neutral-400 py-4">Loading your shifts…</p>}
              {!loading && giveShifts?.length === 0 && (
                <p className="text-sm text-neutral-500 py-4">
                  No upcoming assigned shifts in this pay period to {kind === "SWAP" ? "swap" : "give away"}.
                </p>
              )}
              <div className="space-y-2">
                {giveShifts?.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setGiveShiftId(s.id)}
                    className={cn(
                      "w-full text-left border rounded-lg px-3 py-2.5 text-sm transition-colors",
                      giveShiftId === s.id
                        ? "border-primary-500 bg-primary-50 ring-1 ring-primary-500"
                        : "border-neutral-200 hover:border-primary-300"
                    )}
                  >
                    <p className="font-semibold text-neutral-800">
                      {s.departmentName} · {s.roleNeeded}
                    </p>
                    <p className="text-neutral-500 text-xs mt-0.5">
                      {hospitalWeekday(s.startsAt)}, {hospitalMonthDay(s.startsAt)} · {formatShiftRange(s.startsAt, s.endsAt)}
                    </p>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 2 && kind === "SWAP" && (
            <>
              <p className="text-sm text-neutral-500">
                {giveShift?.departmentName}, same pay period only. Eligible shifts are selectable.
              </p>
              {loading && <p className="text-sm text-neutral-400 py-4">Loading your unit&apos;s roster…</p>}
              {!loading && swapByDay.length === 0 && (
                <p className="text-sm text-neutral-500 py-4">No colleague shifts found in this pay period.</p>
              )}
              <div className="space-y-3">
                {swapByDay.map(([day, rows]) => (
                  <div key={day}>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400 mb-1">
                      {hospitalWeekday(rows[0].startsAt)}, {day}
                    </p>
                    <div className="space-y-1.5">
                      {rows.map((row) => (
                        <CandidateRow
                          key={row.shiftId}
                          eligible={row.eligible}
                          onClick={() => pickSwapCandidate(row)}
                          name={row.userName}
                          detail={
                            row.eligible
                              ? `${formatShiftRange(row.startsAt, row.endsAt)} · eligible`
                              : `${formatShiftRange(row.startsAt, row.endsAt)} · ${row.blockedReason}`
                          }
                          actionLabel="Select"
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 2 && kind === "GIVEAWAY" && (
            <>
              <p className="text-sm text-neutral-500">{giveShift?.departmentName} colleagues only.</p>
              <div className="flex items-center gap-2 border border-neutral-300 rounded-lg px-3 py-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name…"
                  className="flex-1 min-w-0 text-sm outline-none"
                />
              </div>
              {loading && <p className="text-sm text-neutral-400 py-4">Loading your unit&apos;s roster…</p>}
              {!loading && giveawayCandidates?.length === 0 && (
                <p className="text-sm text-neutral-500 py-4">No colleagues found.</p>
              )}
              <div className="space-y-1.5">
                {giveawayCandidates?.map((row) => (
                  <CandidateRow
                    key={row.userId}
                    eligible={row.eligible}
                    onClick={() => pickGiveawayCandidate(row)}
                    name={row.userName}
                    detail={row.eligible ? row.position ?? "eligible" : row.blockedReason ?? "not eligible"}
                    actionLabel="Select"
                  />
                ))}
              </div>
            </>
          )}

          {step === 3 && giveShift && (
            <>
              {!submitted ? (
                <>
                  <p className="text-sm text-neutral-500">Review before it goes out.</p>
                  <div className="space-y-2">
                    <SummaryRow
                      label="You give"
                      detail={`${hospitalWeekday(giveShift.startsAt)}, ${hospitalMonthDay(giveShift.startsAt)} · ${formatShiftRange(giveShift.startsAt, giveShift.endsAt)} (${giveShift.departmentName})`}
                    />
                    {kind === "SWAP" && receiveShiftRange ? (
                      <SummaryRow
                        label="You receive"
                        detail={`${hospitalWeekday(receiveShiftRange.startsAt)}, ${hospitalMonthDay(receiveShiftRange.startsAt)} · ${formatShiftRange(receiveShiftRange.startsAt, receiveShiftRange.endsAt)} · from ${targetUserName}`}
                      />
                    ) : (
                      <SummaryRow label="Offered to" detail={targetUserName ?? ""} />
                    )}
                  </div>
                </>
              ) : (
                <div className="bg-primary-50 border border-primary-200 rounded-lg p-3 text-sm text-primary-800 text-center">
                  Request sent. Next: {targetUserName} accepts, then your manager approves - you&apos;ll be
                  notified at each step.
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-neutral-200">
          {!submitted ? (
            <>
              <button
                type="button"
                onClick={() => (step === 1 ? onClose() : setStep((s) => (s - 1) as Step))}
                className="flex-1 h-10 rounded-md border border-neutral-300 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                {step === 1 ? "Cancel" : "Back"}
              </button>
              {step < 3 && (
                <button
                  type="button"
                  disabled={step === 1 && !giveShiftId}
                  onClick={goToStep2}
                  className="flex-[2] h-10 rounded-md bg-primary-700 text-white text-sm font-semibold hover:bg-primary-800 disabled:opacity-50"
                >
                  Next
                </button>
              )}
              {step === 3 && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleSubmit}
                  className="flex-[2] h-10 rounded-md bg-primary-700 text-white text-sm font-semibold hover:bg-primary-800 disabled:opacity-50"
                >
                  {loading ? "Sending…" : "Send Request"}
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-10 rounded-md bg-primary-700 text-white text-sm font-semibold hover:bg-primary-800"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PayPeriodPill({ start, end }: { start: Date; end: Date }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary-700 bg-primary-50 border border-primary-200 rounded-full px-2.5 py-1">
      Pay period: {hospitalMonthDay(start)} – {hospitalMonthDay(end)}
    </span>
  );
}

function CandidateRow({
  eligible,
  onClick,
  name,
  detail,
  actionLabel,
}: {
  eligible: boolean;
  onClick: () => void;
  name: string;
  detail: string;
  actionLabel: string;
}) {
  return (
    <button
      type="button"
      disabled={!eligible}
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
        eligible ? "bg-emerald-50 hover:bg-emerald-100 cursor-pointer" : "bg-neutral-100 opacity-80 cursor-not-allowed"
      )}
    >
      <span className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 text-[10px] font-extrabold flex items-center justify-center shrink-0">
        {name
          .split(" ")
          .map((n) => n[0])
          .join("")
          .toUpperCase()
          .slice(0, 2)}
      </span>
      <span className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-neutral-800 truncate">{name}</p>
        <p className={cn("text-[11px] truncate", eligible ? "text-emerald-700 font-semibold" : "text-accent-700 font-semibold")}>
          {detail}
        </p>
      </span>
      {eligible && (
        <span className="text-[10px] font-bold bg-primary-700 text-white rounded px-1.5 py-0.5 shrink-0">
          {actionLabel}
        </span>
      )}
    </button>
  );
}

function SummaryRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm">
      <p className="font-semibold text-neutral-800">{label}:</p>
      <p className="text-neutral-500 text-xs mt-0.5">{detail}</p>
    </div>
  );
}
