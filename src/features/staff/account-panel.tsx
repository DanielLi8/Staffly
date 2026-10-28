"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useModalPanel } from "@/lib/use-modal-panel";
import { formatShiftRange } from "@/lib/utils";
import { hospitalDate } from "@/lib/timezone";
import { DEACTIVATION_REASONS, type StaffStatus, type UpcomingShift } from "@/lib/staff/accounts";
import { deactivateStaffMember, reactivateStaffMember } from "@/app/actions/staff";
import { StaffStatusPill } from "./staff-status-pill";

export interface AccountPanelProps {
  userId: string;
  name: string;
  status: StaffStatus;
  deactivatedAt: Date | null;
  deactivationReason: string | null;
  /** Whether this admin may deactivate / reactivate (`canManageStaffAccounts`). */
  canManage: boolean;
  /** Assigned shifts that haven't ended; they block deactivation. */
  upcomingShifts: UpcomingShift[];
  bidCount: number;
  assignedCount: number;
}

function UpcomingShiftList({ shifts }: { shifts: UpcomingShift[] }) {
  return (
    <ul className="max-h-48 space-y-1 overflow-y-auto">
      {shifts.map((s) => (
        <li key={s.id}>
          <Link
            href={`/admin/shifts/${s.id}`}
            className="text-sm font-medium text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-sm"
          >
            {formatShiftRange(s.startsAt, s.endsAt)}
          </Link>
          <span className="text-sm text-neutral-500"> · {s.departmentName}</span>
        </li>
      ))}
    </ul>
  );
}

function DeactivateDialog({
  userId,
  name,
  upcomingShifts,
  onClose,
}: {
  userId: string;
  name: string;
  upcomingShifts: UpcomingShift[];
  onClose: () => void;
}) {
  const router = useRouter();
  const panelRef = useModalPanel<HTMLDivElement>(onClose);
  const [reason, setReason] = useState<string>(DEACTIVATION_REASONS[0]);
  const [blocking, setBlocking] = useState<UpcomingShift[]>(upcomingShifts);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError("");
    startTransition(async () => {
      try {
        const result = await deactivateStaffMember({ userId, reason });
        if (result.ok || result.reason === "ALREADY_DEACTIVATED") {
          onClose();
          router.refresh();
        } else if (result.reason === "HAS_UPCOMING_SHIFTS") {
          setBlocking(result.shifts);
        } else if (result.reason === "NOT_FOUND") {
          setError("This staff member no longer exists.");
        } else {
          setError("Pick a reason.");
        }
      } catch {
        setError("Couldn't deactivate. Check your connection and try again.");
      }
    });
  }

  return (
    <div className="!m-0 fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="deactivate-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white shadow-xl focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-5 py-4">
          <h2 id="deactivate-title" className="section-title">
            Deactivate {name}?
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 inline-flex h-10 w-10 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {blocking.length > 0 ? (
            <div role="alert" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
              <p className="flex items-start gap-2 text-sm font-medium">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {name} still has {blocking.length} upcoming {blocking.length === 1 ? "shift" : "shifts"}. Cancel or
                swap {blocking.length === 1 ? "it" : "them"} first, so no shift is left covered by someone who
                can&apos;t come.
              </p>
              <UpcomingShiftList shifts={blocking} />
            </div>
          ) : (
            <>
              <div>
                <Label htmlFor="deactivate-reason">Reason</Label>
                <Select id="deactivate-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                  {DEACTIVATION_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </div>
              <p className="text-sm text-neutral-600">
                From now on they can&apos;t sign in, aren&apos;t called out, can&apos;t bid by app, text or phone, and
                aren&apos;t offered for swaps. Their pending bids are withdrawn and open swap requests cancelled.
                Their history stays, and a system administrator can reactivate them.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-accent">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 rounded-b-xl border-t border-neutral-100 bg-neutral-50 px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {blocking.length > 0 ? "Close" : "Cancel"}
          </Button>
          {blocking.length === 0 && (
            <Button variant="danger" onClick={confirm} loading={pending}>
              Deactivate
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The person page's Account card: status, a little activity, and - only for
 * an admin `canManageStaffAccounts` allows - Deactivate / Reactivate.
 */
export function AccountPanel(props: AccountPanelProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function reactivate() {
    setError("");
    startTransition(async () => {
      try {
        const result = await reactivateStaffMember(props.userId);
        if (!result.ok && result.reason === "NOT_FOUND") {
          setError("This staff member no longer exists.");
          return;
        }
        router.refresh();
      } catch {
        setError("Couldn't reactivate. Check your connection and try again.");
      }
    });
  }

  return (
    <section aria-labelledby="account-heading" className="card-base space-y-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="account-heading" className="section-title">
          Account
        </h2>
        <StaffStatusPill status={props.status} />
      </div>

      {props.status === "PENDING" && (
        <p className="text-sm text-neutral-600">
          They have no password yet, so they can&apos;t sign in. Sign-in invites aren&apos;t available yet.
        </p>
      )}
      {props.status === "DEACTIVATED" && props.deactivatedAt && (
        <p className="text-sm text-neutral-600">
          Deactivated {hospitalDate(props.deactivatedAt)}
          {props.deactivationReason ? ` · ${props.deactivationReason}` : ""}.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-neutral-50 px-3 py-2">
          <dt className="text-2xs font-bold uppercase tracking-wide text-neutral-600">Bids</dt>
          <dd className="font-semibold tabular-nums text-neutral-900">{props.bidCount}</dd>
        </div>
        <div className="rounded-lg bg-neutral-50 px-3 py-2">
          <dt className="text-2xs font-bold uppercase tracking-wide text-neutral-600">Assigned</dt>
          <dd className="font-semibold tabular-nums text-neutral-900">{props.assignedCount}</dd>
        </div>
      </dl>

      {props.canManage ? (
        props.status === "DEACTIVATED" ? (
          <Button variant="outline" className="w-full" onClick={reactivate} loading={pending}>
            Reactivate
          </Button>
        ) : (
          <Button
            variant="outline"
            className="w-full border-accent-200 text-accent hover:bg-red-50"
            onClick={() => setDialogOpen(true)}
          >
            Deactivate…
          </Button>
        )
      ) : (
        <p className="text-xs text-neutral-500">
          Only system administrators can add, deactivate or reactivate staff accounts.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-accent">
          {error}
        </p>
      )}

      {dialogOpen && (
        <DeactivateDialog
          userId={props.userId}
          name={props.name}
          upcomingShifts={props.upcomingShifts}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </section>
  );
}
