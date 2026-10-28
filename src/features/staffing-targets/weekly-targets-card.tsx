"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { DayOfWeek, StaffingRole } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { ScrollAreaX } from "@/components/ui/scroll-area-x";
import { cn } from "@/lib/utils";
import { saveWeeklyTargets } from "@/app/actions/staffing-targets";
import type { TemplateView, StaffingTargetsView } from "@/lib/staffing/store";
import { STAFFING_ROLES, STAFFING_ROLE_LABEL, STAFFING_ROLE_NAME } from "@/lib/staffing/roles";
import {
  DAY_SHORT_LABEL,
  DISPLAY_DAYS,
  WEEKDAYS,
  WEEKEND_DAYS,
  buildTargetBook,
  weeklyTarget,
} from "@/lib/staffing/targets";
import { formatTemplateRange, templateDurationMinutes, formatDurationHours } from "@/lib/staffing/templates";
import { CountStepper } from "./count-stepper";
import type { RunStaffingAction } from "./use-staffing-action";

type Layout = "grouped" | "by-day";

interface Column {
  id: string;
  label: string;
  sub?: string;
  /** Lower-case form for accessible names ("Day RN, weekdays"). */
  a11y: string;
  days: readonly DayOfWeek[];
}

const GROUPED: Column[] = [
  { id: "weekdays", label: "Weekdays", sub: "Mon–Fri", a11y: "weekdays", days: WEEKDAYS },
  { id: "weekends", label: "Weekends", sub: "Sat–Sun", a11y: "weekends", days: WEEKEND_DAYS },
];

const BY_DAY: Column[] = DISPLAY_DAYS.map((d) => ({ id: d, label: DAY_SHORT_LABEL[d], a11y: DAY_SHORT_LABEL[d], days: [d] }));

const cellKey = (templateId: string, role: StaffingRole, day: DayOfWeek) => `${templateId}|${role}|${day}`;

/** One value for a set of per-day numbers, or null when they differ. */
function shared(values: number[]): number | null {
  return values.every((v) => v === values[0]) ? values[0] : null;
}

/**
 * The weekly projected numbers: shift x role rows, Weekdays / Weekends
 * columns (or one column per day). Storage is always per day of week; the
 * grouped layout is only a view, and a grouped cell whose days differ shows
 * "–" until the admin sets them all. Edits collect locally and go out in one
 * save, which the server refuses if anyone changed a number underneath.
 */
export function WeeklyTargetsCard({
  departmentId,
  templates,
  weekly,
  run,
  pending,
}: {
  departmentId: string;
  templates: TemplateView[];
  weekly: StaffingTargetsView["weekly"];
  run: RunStaffingAction;
  pending: boolean;
}) {
  const book = useMemo(() => buildTargetBook(weekly, []), [weekly]);
  const [layout, setLayout] = useState<Layout>("grouped");
  const [edits, setEdits] = useState<Record<string, number>>({});

  // A server refresh (our save, or someone else's) makes the edits' baseline
  // obsolete; drop any edit that now matches what is saved.
  useEffect(() => {
    setEdits((prev) => {
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(prev)) {
        const [templateId, role, day] = k.split("|") as [string, StaffingRole, DayOfWeek];
        if (weeklyTarget(book, templateId, day, role) !== v) next[k] = v;
      }
      return next;
    });
  }, [book]);

  const saved = (t: string, r: StaffingRole, d: DayOfWeek) => weeklyTarget(book, t, d, r);
  const current = (t: string, r: StaffingRole, d: DayOfWeek) => edits[cellKey(t, r, d)] ?? saved(t, r, d);
  const dirtyKeys = Object.keys(edits);
  const dirty = dirtyKeys.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function setCell(templateId: string, role: StaffingRole, days: readonly DayOfWeek[], value: number) {
    setEdits((prev) => {
      const next = { ...prev };
      for (const d of days) {
        const k = cellKey(templateId, role, d);
        if (saved(templateId, role, d) === value) delete next[k];
        else next[k] = value;
      }
      return next;
    });
  }

  function save() {
    // One change per (shift, role, new number), so the history reads
    // "Day RN, Weekdays: 4 → 5" rather than five per-day lines.
    const groups = new Map<string, { templateId: string; role: StaffingRole; count: number; days: DayOfWeek[] }>();
    for (const k of dirtyKeys) {
      const [templateId, role, day] = k.split("|") as [string, StaffingRole, DayOfWeek];
      const gk = `${templateId}|${role}|${edits[k]}`;
      const g = groups.get(gk) ?? { templateId, role, count: edits[k], days: [] };
      g.days.push(day);
      groups.set(gk, g);
    }
    const changes = Array.from(groups.values()).map((g) => {
      const days = DISPLAY_DAYS.filter((d) => g.days.includes(d));
      return { ...g, days, before: days.map((d) => saved(g.templateId, g.role, d)) };
    });
    run(
      () => saveWeeklyTargets({ departmentId, changes }),
      (result) => {
        if (result.ok || result.reason === "STALE") setEdits({});
      }
    );
  }

  const columns = layout === "grouped" ? GROUPED : BY_DAY;
  const changeCount = new Set(dirtyKeys.map((k) => k.split("|").slice(0, 2).join("|"))).size;

  return (
    <section className="card-base" aria-labelledby="weekly-targets-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h2 id="weekly-targets-heading" className="section-title">
            Projected staffing
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            How many of each role every shift needs in a usual week. A Team Lead counts as an RN.
          </p>
        </div>
        <div role="radiogroup" aria-label="Columns" className="inline-flex rounded-full bg-neutral-100 p-1">
          {(["grouped", "by-day"] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={layout === l}
              onClick={() => setLayout(l)}
              className={cn(
                "h-8 rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                layout === l ? "bg-white text-primary-800 shadow-sm" : "text-neutral-600 hover:text-neutral-900"
              )}
            >
              {l === "grouped" ? "Weekdays / weekends" : "By day"}
            </button>
          ))}
        </div>
      </div>

      <ScrollAreaX label="Projected staffing table" innerClassName="px-2 sm:px-3">
        <table className={cn("w-full border-separate border-spacing-0 text-sm", layout === "grouped" && "sm:max-w-lg")}>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-white px-2 py-2 text-left text-2xs font-bold uppercase tracking-wide text-neutral-500">
                <span className="sr-only">Shift and role</span>
              </th>
              {columns.map((c) => (
                <th key={c.id} scope="col" className="px-1 py-2 text-center">
                  <span className="block text-2xs font-bold uppercase tracking-wide text-neutral-600">{c.label}</span>
                  {c.sub && <span className="block text-xs font-normal text-neutral-500">{c.sub}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <Fragment key={t.id}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={columns.length + 1}
                    className="border-t border-neutral-200 px-2 pb-1 pt-3 text-left font-normal"
                  >
                    <span className="sticky left-2">
                      <span className="font-semibold text-neutral-900">{t.label}</span>{" "}
                      <span className="tabular-nums text-neutral-500">
                        {formatTemplateRange(t)} ·{" "}
                        {formatDurationHours(templateDurationMinutes(t.startMinute, t.endMinute))}
                      </span>
                    </span>
                  </th>
                </tr>
                {STAFFING_ROLES.map((role) => (
                  <tr key={role}>
                    <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-1 text-left font-medium text-neutral-700">
                      <abbr title={STAFFING_ROLE_NAME[role]} className="no-underline">
                        {STAFFING_ROLE_LABEL[role]}
                      </abbr>
                    </th>
                    {columns.map((c) => {
                      const values = c.days.map((d) => current(t.id, role, d));
                      const isDirty = c.days.some((d) => cellKey(t.id, role, d) in edits);
                      return (
                        <td key={c.id} className="px-1 py-1 text-center">
                          <CountStepper
                            value={shared(values)}
                            dirty={isDirty}
                            disabled={pending}
                            label={`${t.label} ${STAFFING_ROLE_LABEL[role]}, ${c.a11y}`}
                            variesHint={`varies: ${c.days.map((d, i) => `${DAY_SHORT_LABEL[d]} ${values[i]}`).join(", ")}`}
                            onChange={(n) => setCell(t.id, role, c.days, n)}
                            compact={layout === "by-day"}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 pb-2 pt-1 text-left text-xs font-medium text-neutral-500">
                    On shift
                  </th>
                  {columns.map((c) => {
                    const total = shared(
                      c.days.map((d) => STAFFING_ROLES.reduce((sum, r) => sum + current(t.id, r, d), 0))
                    );
                    return (
                      <td key={c.id} className="px-1 pb-2 pt-1 text-center text-xs tabular-nums text-neutral-600">
                        {total ?? "varies"}
                      </td>
                    );
                  })}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </ScrollAreaX>

      <div
        className={cn(
          "flex flex-wrap items-center justify-end gap-3 rounded-b-xl border-t px-4 py-3 sm:px-5",
          dirty ? "border-primary-100 bg-primary-50" : "border-neutral-100"
        )}
      >
        <p className="mr-auto text-sm text-neutral-600" aria-live="polite">
          {dirty
            ? `${changeCount} unsaved ${changeCount === 1 ? "change" : "changes"}`
            : "Changes apply to every week. Use date overrides below for one-off days."}
        </p>
        {dirty && (
          <>
            <Button variant="outline" size="sm" onClick={() => setEdits({})} disabled={pending}>
              Discard
            </Button>
            <Button size="sm" onClick={save} loading={pending}>
              Save changes
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
