"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEPARTMENT_ICON_KEYS, getDepartmentIcon } from "@/lib/department-icons";
import {
  validateDepartmentInput,
  type DepartmentFieldErrors,
  type DepartmentFormInput,
} from "@/lib/departments/validation";
import { createDepartment, updateDepartment } from "@/app/actions/departments";
import { cn } from "@/lib/utils";
import type { DepartmentRow } from "./types";

const EMPTY: DepartmentFormInput = { name: "", code: "", wing: "", iconKey: "star" };

function DepartmentForm({
  idPrefix,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  idPrefix: string;
  initial: DepartmentFormInput;
  submitLabel: string;
  onSubmit: (input: DepartmentFormInput) => Promise<{ fieldErrors: DepartmentFieldErrors; formError?: string } | null>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<DepartmentFieldErrors>({});
  const [formError, setFormError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    const local = validateDepartmentInput(form, DEPARTMENT_ICON_KEYS);
    if (!local.ok) {
      setErrors(local.fieldErrors);
      return;
    }
    setErrors({});
    startTransition(async () => {
      try {
        const failure = await onSubmit(form);
        if (failure) {
          setErrors(failure.fieldErrors);
          setFormError(failure.formError ?? "");
        }
      } catch {
        setFormError("Couldn't save. Check your connection and try again.");
      }
    });
  }

  const field = (key: keyof DepartmentFormInput) => ({
    id: `${idPrefix}-${key}`,
    value: form[key],
    error: errors[key as keyof DepartmentFieldErrors],
    "aria-invalid": errors[key as keyof DepartmentFieldErrors] ? true : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <div>
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input {...field("name")} placeholder="Emergency Department" autoComplete="off" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${idPrefix}-code`}>Code</Label>
          <Input {...field("code")} placeholder="ER" autoComplete="off" className="uppercase" />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-wing`}>Wing (optional)</Label>
          <Input {...field("wing")} placeholder="North" autoComplete="off" />
        </div>
      </div>
      <fieldset>
        <legend className="mb-1 block text-sm font-medium text-neutral-700">Icon</legend>
        <div className="flex flex-wrap gap-1.5">
          {DEPARTMENT_ICON_KEYS.map((key) => {
            const Icon = getDepartmentIcon(key);
            const selected = form.iconKey === key;
            return (
              <label
                key={key}
                className={cn(
                  "inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-md border transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-500",
                  selected ? "border-primary-700 bg-primary-50 text-primary-700" : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100"
                )}
              >
                <input
                  type="radio"
                  name={`${idPrefix}-icon`}
                  value={key}
                  checked={selected}
                  onChange={() => setForm((f) => ({ ...f, iconKey: key }))}
                  className="sr-only"
                  aria-label={key}
                />
                <Icon className="h-4 w-4" aria-hidden />
              </label>
            );
          })}
        </div>
      </fieldset>
      {formError && (
        <p role="alert" className="text-sm text-accent">
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * The Staff page's small department list: every department with its member
 * count, editable in place, plus "Add department". Departments are never
 * deleted (shifts and history reference them).
 */
export function DepartmentList({ departments }: { departments: DepartmentRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);

  async function save(id: string | null, input: DepartmentFormInput) {
    const result = id ? await updateDepartment(id, input) : await createDepartment(input);
    if (!result.ok) return result;
    setEditing(null);
    router.refresh();
    return null;
  }

  return (
    <section aria-labelledby="departments-heading" className="card-base p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="departments-heading" className="section-title">
          Departments
        </h2>
        {editing !== "new" && (
          <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" aria-hidden />
            Add department
          </Button>
        )}
      </div>

      {editing === "new" && (
        <div className="mb-3">
          <DepartmentForm
            idPrefix="dept-new"
            initial={EMPTY}
            submitLabel="Add department"
            onSubmit={(input) => save(null, input)}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {departments.length === 0 ? (
        <p className="text-sm text-neutral-500">No departments yet. Add the first one above.</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {departments.map((d) => {
            const Icon = getDepartmentIcon(d.iconKey);
            if (editing === d.id) {
              return (
                <li key={d.id} className="py-2">
                  <DepartmentForm
                    idPrefix={`dept-${d.id}`}
                    initial={{ name: d.name, code: d.code, wing: d.wing ?? "", iconKey: d.iconKey }}
                    submitLabel="Save"
                    onSubmit={(input) => save(d.id, input)}
                    onCancel={() => setEditing(null)}
                  />
                </li>
              );
            }
            return (
              <li key={d.id} className="flex items-center gap-3 py-2.5">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-neutral-900">{d.name}</p>
                  <p className="truncate text-xs text-neutral-500">
                    {d.code} · {d.memberCount} {d.memberCount === 1 ? "person" : "people"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(d.id)}
                  aria-label={`Edit ${d.name}`}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
