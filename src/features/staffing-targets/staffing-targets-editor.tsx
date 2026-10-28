"use client";

import { Toast } from "@/components/ui/toast";
import type { StaffingTargetsView } from "@/lib/staffing/store";
import { activeTemplates } from "@/lib/staffing/templates";
import { hospitalDateTime } from "@/lib/timezone";
import { DateOverridesCard } from "./date-overrides-card";
import { ShiftDefinitionsCard } from "./shift-definitions-card";
import { WeeklyTargetsCard } from "./weekly-targets-card";
import { useStaffingAction } from "./use-staffing-action";

/**
 * The staffing targets page body: shift length + times, the weekly projected
 * numbers, one-date overrides, and the change history. This is the only
 * place projected numbers are edited (captain decision projected-edit-scope).
 */
export function StaffingTargetsEditor({ view }: { view: StaffingTargetsView }) {
  const { run, pending, toast, dismissToast } = useStaffingAction();
  const templates = activeTemplates(view.templates, view.department.shiftPattern);

  return (
    <div className="space-y-6">
      <WeeklyTargetsCard
        departmentId={view.department.id}
        templates={templates}
        weekly={view.weekly}
        run={run}
        pending={pending}
      />
      <DateOverridesCard
        departmentId={view.department.id}
        templates={templates}
        weekly={view.weekly}
        overrides={view.overrides}
        today={view.today}
        run={run}
        pending={pending}
      />
      <ShiftDefinitionsCard
        departmentId={view.department.id}
        pattern={view.department.shiftPattern}
        templates={view.templates}
        run={run}
        pending={pending}
      />
      <ChangeHistory history={view.history} />
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

function ChangeHistory({ history }: { history: StaffingTargetsView["history"] }) {
  return (
    <section className="card-base" aria-labelledby="change-history-heading">
      <div className="border-b border-neutral-100 px-4 py-4 sm:px-5">
        <h2 id="change-history-heading" className="section-title">
          Change history
        </h2>
        <p className="mt-0.5 text-sm text-neutral-500">Every change to these numbers, with who made it and when.</p>
      </div>
      {history.length === 0 ? (
        <p className="px-4 py-4 text-sm text-neutral-500 sm:px-5">No changes yet.</p>
      ) : (
        <ol className="divide-y divide-neutral-100">
          {history.map((h) => (
            <li key={h.id} className="px-4 py-2.5 sm:px-5">
              <p className="text-sm text-neutral-900">{h.line}</p>
              <p className="text-xs text-neutral-500">
                {h.actorName} · <time dateTime={h.at}>{hospitalDateTime(h.at)}</time>
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
