"use client";

import { useMemo, useState } from "react";
import type { StaffingRole } from "@prisma/client";
import { CalendarDays, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { applySundayNumbers, removeTargetOverride, setTargetOverride } from "@/app/actions/staffing-targets";
import type { OverrideView, StaffingTargetsView, TemplateView } from "@/lib/staffing/store";
import { formatDayKey } from "@/lib/staffing/audit";
import { STAFFING_ROLES, STAFFING_ROLE_LABEL } from "@/lib/staffing/roles";
import {
  DAY_PLURAL_LABEL,
  MAX_OVERRIDE_REASON_LENGTH,
  buildTargetBook,
  dayOfWeekOfKey,
  effectiveTarget,
  isDayKey,
} from "@/lib/staffing/targets";
import { CountStepper } from "./count-stepper";
import type { RunStaffingAction } from "./use-staffing-action";

/**
 * One-date exceptions (census spike, holiday). An override wins over the
 * weekly number for that date only; setting a date back to its usual number
 * removes the override.
 */
export function DateOverridesCard({
  departmentId,
  templates,
  weekly,
  overrides,
  today,
  run,
  pending,
}: {
  departmentId: string;
  templates: TemplateView[];
  weekly: StaffingTargetsView["weekly"];
  overrides: OverrideView[];
  today: string;
  run: RunStaffingAction;
  pending: boolean;
}) {
  const book = useMemo(() => buildTargetBook(weekly, overrides), [weekly, overrides]);
  const templateById = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);
  const shown = overrides.filter((o) => templateById.has(o.templateId));

  const [date, setDate] = useState("");
  const [chosenTemplateId, setTemplateId] = useState(templates[0]?.id ?? "");
  // After a switch between 8- and 12-hour shifts the chosen shift may be gone.
  const templateId = templateById.has(chosenTemplateId) ? chosenTemplateId : (templates[0]?.id ?? "");
  const [role, setRole] = useState<StaffingRole>("RN");
  const [count, setCount] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  const validDate = isDayKey(date) && date >= today;
  const target = validDate && templateById.has(templateId) ? effectiveTarget(book, templateId, date, role) : null;
  const value = count ?? target?.count ?? 0;

  function reset() {
    setCount(null);
    setReason("");
  }

  function submit() {
    if (!target) return;
    run(
      () =>
        setTargetOverride({
          templateId,
          date,
          role,
          count: value,
          reason: reason.trim() || null,
          expected: target.override?.count ?? null,
        }),
      (r) => r.ok && reset()
    );
  }

  return (
    <section className="card-base" aria-labelledby="date-overrides-heading">
      <div className="border-b border-neutral-100 px-4 py-4 sm:px-5">
        <h2 id="date-overrides-heading" className="section-title">
          Date overrides
        </h2>
        <p className="mt-0.5 text-sm text-neutral-500">
          A different number for one date only, such as a census spike or a holiday.
        </p>
      </div>

      <div className="space-y-3 px-4 py-4 sm:px-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-[10rem_9rem_7rem_auto_1fr]">
          <div className="col-span-2 lg:col-span-1">
            <label htmlFor="override-date" className="mb-1 block text-xs font-medium text-neutral-600">
              Date
            </label>
            <Input
              id="override-date"
              type="date"
              min={today}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setCount(null);
              }}
            />
          </div>
          <div>
            <label htmlFor="override-shift" className="mb-1 block text-xs font-medium text-neutral-600">
              Shift
            </label>
            <Select
              id="override-shift"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setCount(null);
              }}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="override-role" className="mb-1 block text-xs font-medium text-neutral-600">
              Role
            </label>
            <Select
              id="override-role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value as StaffingRole);
                setCount(null);
              }}
            >
              {STAFFING_ROLES.map((r) => (
                <option key={r} value={r}>
                  {STAFFING_ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-neutral-600">
              Number
            </span>
            <CountStepper
              value={target ? value : null}
              onChange={setCount}
              label="Number needed on that date"
              dirty={target !== null && value !== target.count}
              disabled={!target || pending}
            />
          </div>
          <div className="lg:col-span-1">
            <label htmlFor="override-reason" className="mb-1 block text-xs font-medium text-neutral-600">
              Reason <span className="font-normal text-neutral-500">(optional)</span>
            </label>
            <Input
              id="override-reason"
              value={reason}
              maxLength={MAX_OVERRIDE_REASON_LENGTH}
              placeholder="e.g. Census 31 of 30"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <p className="mr-auto text-sm text-neutral-600" aria-live="polite">
            {!date
              ? "Pick a date to see its usual number."
              : !validDate
                ? "Pick today or a later date."
                : target && (
                    <>
                      Usually {target.usual} on {DAY_PLURAL_LABEL[dayOfWeekOfKey(date)]}
                      {target.source === "OVERRIDE" && `; currently set to ${target.count} for ${formatDayKey(date)}`}.
                    </>
                  )}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={!validDate || pending}
            onClick={() =>
              run(
                () => applySundayNumbers({ departmentId, date, reason: reason.trim() || null }),
                (r) => r.ok && reset()
              )
            }
          >
            <CalendarDays className="h-4 w-4" aria-hidden />
            Holiday: use Sunday numbers
          </Button>
          <Button size="sm" disabled={!target || value === target.count} loading={pending} onClick={submit}>
            {target && target.source === "OVERRIDE" && value === target.usual ? "Back to usual" : "Set for this date"}
          </Button>
        </div>
      </div>

      <div className="border-t border-neutral-100 px-4 py-4 sm:px-5">
        <h3 className="mb-2 text-2xs font-bold uppercase tracking-wide text-neutral-600">Upcoming overrides</h3>
        {shown.length === 0 ? (
          <p className="text-sm text-neutral-500">No upcoming overrides. Every date uses the weekly numbers.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {shown.map((o) => {
              const t = templateById.get(o.templateId)!;
              const usual = effectiveTarget(book, o.templateId, o.date, o.role).usual;
              return (
                <li key={o.id} className="flex items-start gap-3 py-2.5">
                  <div className="grid min-w-0 flex-1 gap-x-4 gap-y-0.5 sm:grid-cols-[7rem_7rem_7rem_1fr]">
                    <p className="font-semibold text-neutral-900">{formatDayKey(o.date)}</p>
                    <p className="text-sm text-neutral-700">
                      {t.label} {STAFFING_ROLE_LABEL[o.role]}:{" "}
                      <span className="font-semibold tabular-nums text-neutral-900 sm:hidden">{o.count}</span>
                      <span className="tabular-nums text-neutral-500 sm:hidden"> (usually {usual})</span>
                    </p>
                    <p className="hidden text-sm tabular-nums text-neutral-900 sm:block">
                      <span className="font-semibold">{o.count}</span>{" "}
                      <span className="text-neutral-500">(usually {usual})</span>
                    </p>
                    <p className="min-w-0 text-sm text-neutral-600">
                      {o.reason ?? <span className="text-neutral-500">No reason given</span>}
                      {o.setByName && <span className="block text-xs text-neutral-500">Set by {o.setByName}</span>}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    disabled={pending}
                    onClick={() => run(() => removeTargetOverride({ overrideId: o.id }))}
                    aria-label={`Remove override: ${t.label} ${STAFFING_ROLE_LABEL[o.role]} on ${formatDayKey(o.date)}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
