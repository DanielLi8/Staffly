"use client";

import { useEffect, useState } from "react";
import type { ShiftPattern } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { setShiftPattern, updateShiftTemplate } from "@/app/actions/staffing-targets";
import type { TemplateView } from "@/lib/staffing/store";
import {
  SHIFT_PATTERNS,
  TEMPLATE_MINUTE_OPTIONS,
  TEMPLATE_TIMES_MESSAGE,
  activeTemplates,
  endsNextDay,
  formatClockMinute,
  formatDurationHours,
  templateDurationMinutes,
  validateTemplateTimes,
} from "@/lib/staffing/templates";
import type { RunStaffingAction } from "./use-staffing-action";

const PATTERN_OPTION: Record<ShiftPattern, { title: string; detail: string }> = {
  EIGHT_HOUR: { title: "8-hour shifts", detail: "Day, Evening, Night" },
  TWELVE_HOUR: { title: "12-hour shifts", detail: "Day, Night" },
};

/**
 * The department's shift length and shift times. Switching length only
 * changes which shifts the numbers below are counted against; both sets stay
 * available when entering a shift, and each keeps its own numbers.
 */
export function ShiftDefinitionsCard({
  departmentId,
  pattern,
  templates,
  run,
  pending,
}: {
  departmentId: string;
  pattern: ShiftPattern;
  templates: TemplateView[];
  run: RunStaffingAction;
  pending: boolean;
}) {
  return (
    <section className="card-base" aria-labelledby="shift-definitions-heading">
      <div className="border-b border-neutral-100 px-4 py-4 sm:px-5">
        <h2 id="shift-definitions-heading" className="section-title">
          Shifts
        </h2>
        <p className="mt-0.5 text-sm text-neutral-500">
          The shifts this unit is staffed by. Either length can still be entered when booking a shift.
        </p>
      </div>
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <fieldset>
          <legend className="mb-2 text-2xs font-bold uppercase tracking-wide text-neutral-600">Shift length</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {SHIFT_PATTERNS.map((p) => {
              const checked = p === pattern;
              return (
                <label
                  key={p}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-500",
                    checked ? "border-primary-500 bg-primary-50" : "border-neutral-200 hover:bg-neutral-50",
                    pending && "pointer-events-none opacity-60"
                  )}
                >
                  <input
                    type="radio"
                    name="shift-pattern"
                    value={p}
                    checked={checked}
                    disabled={pending}
                    onChange={() => run(() => setShiftPattern({ departmentId, from: pattern, to: p }))}
                    className="h-4 w-4 accent-primary-700"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-neutral-900">{PATTERN_OPTION[p].title}</span>
                    <span className="block text-xs text-neutral-600">{PATTERN_OPTION[p].detail}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {activeTemplates(templates, pattern).map((t) => (
            <TemplateRow key={t.id} template={t} run={run} pending={pending} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function TemplateRow({ template, run, pending }: { template: TemplateView; run: RunStaffingAction; pending: boolean }) {
  const saved = { startMinute: template.startMinute, endMinute: template.endMinute, leadRequired: template.leadRequired };
  const [draft, setDraft] = useState(saved);
  useEffect(() => {
    setDraft({ startMinute: template.startMinute, endMinute: template.endMinute, leadRequired: template.leadRequired });
  }, [template.startMinute, template.endMinute, template.leadRequired]);

  const dirty =
    draft.startMinute !== saved.startMinute || draft.endMinute !== saved.endMinute || draft.leadRequired !== saved.leadRequired;
  const error = validateTemplateTimes(draft.startMinute, draft.endMinute);
  const idBase = `template-${template.id}`;

  return (
    <li className="grid grid-cols-2 items-end gap-x-3 gap-y-3 px-3 py-3 sm:flex sm:flex-wrap sm:gap-x-4">
      <div className="col-span-2 shrink-0 self-center sm:w-24">
        <p className="font-semibold text-neutral-900">{template.label}</p>
        <p className="text-xs tabular-nums text-neutral-500">
          {error ? "–" : formatDurationHours(templateDurationMinutes(draft.startMinute, draft.endMinute))}
          {!error && endsNextDay(draft.startMinute, draft.endMinute) && ", ends next day"}
        </p>
      </div>
      <div className="sm:w-28">
        <label htmlFor={`${idBase}-start`} className="mb-1 block text-xs font-medium text-neutral-600">
          Starts
        </label>
        <Select
          id={`${idBase}-start`}
          value={draft.startMinute}
          disabled={pending}
          onChange={(e) => setDraft({ ...draft, startMinute: Number(e.target.value) })}
          className="tabular-nums"
        >
          {TEMPLATE_MINUTE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {formatClockMinute(m)}
            </option>
          ))}
        </Select>
      </div>
      <div className="sm:w-28">
        <label htmlFor={`${idBase}-end`} className="mb-1 block text-xs font-medium text-neutral-600">
          Ends
        </label>
        <Select
          id={`${idBase}-end`}
          value={draft.endMinute}
          disabled={pending}
          onChange={(e) => setDraft({ ...draft, endMinute: Number(e.target.value) })}
          className="tabular-nums"
        >
          {TEMPLATE_MINUTE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {formatClockMinute(m)}
            </option>
          ))}
        </Select>
      </div>
      <label className="col-span-2 flex h-10 items-center gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={draft.leadRequired}
          disabled={pending}
          onChange={(e) => setDraft({ ...draft, leadRequired: e.target.checked })}
          className="h-4 w-4 accent-primary-700"
        />
        Team Lead on shift
      </label>
      {dirty && (
        <div className="col-span-2 flex justify-end gap-2 sm:ml-auto">
          <Button variant="outline" size="sm" onClick={() => setDraft(saved)} disabled={pending}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!!error}
            loading={pending}
            onClick={() => run(() => updateShiftTemplate({ templateId: template.id, before: saved, after: draft }))}
          >
            Save {template.label}
          </Button>
        </div>
      )}
      {dirty && error && (
        <p role="alert" className="basis-full text-sm text-accent">
          {TEMPLATE_TIMES_MESSAGE[error]}
        </p>
      )}
    </li>
  );
}
