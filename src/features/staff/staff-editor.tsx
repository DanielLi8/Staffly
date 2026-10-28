"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { POSITIONS, findPosition } from "@/lib/staff/positions";
import {
  validateStaffInput,
  type StaffField,
  type StaffFieldErrors,
  type StaffFormInput,
} from "@/lib/staff/validation";
import { createStaffMember, updateStaffMember } from "@/app/actions/staff";
import type { DepartmentChoice } from "./types";

export type StaffEditorProps = {
  departments: DepartmentChoice[];
  initial: StaffFormInput;
  /** Whether the stored phone is verified right now (edit only). */
  phoneVerified?: boolean;
  /** A stored position that isn't one of the canonical ones (legacy data). */
  legacyPosition?: string | null;
} & ({ mode: "create" } | { mode: "edit"; userId: string });

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 border-b border-neutral-100 px-5 py-5 last:border-b-0">
      <div>
        <h2 className="section-title">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-neutral-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs text-accent">
      {message}
    </p>
  );
}

/**
 * One staff record: details, phone, Team Lead and department memberships, all
 * saved together. Validation runs here with the same pure rules
 * (`validateStaffInput`) and messages the server action returns as typed
 * field errors, so a bad save never reaches the server.
 */
export function StaffEditor(props: StaffEditorProps) {
  const { departments, initial, mode } = props;
  const router = useRouter();
  const [form, setForm] = useState<StaffFormInput>(initial);
  const [errors, setErrors] = useState<StaffFieldErrors>({});
  const [formError, setFormError] = useState("");
  const [saved, setSaved] = useState(false);
  const [addDepartmentId, setAddDepartmentId] = useState("");
  const [pending, startTransition] = useTransition();

  const departmentById = new Map(departments.map((d) => [d.id, d]));
  const available = departments.filter((d) => !form.memberships.some((m) => m.departmentId === d.id));

  function update(patch: Partial<StaffFormInput>) {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
  }

  function addMembership() {
    if (!addDepartmentId) return;
    const title = findPosition(form.position)?.code ?? "";
    update({ memberships: [...form.memberships, { departmentId: addDepartmentId, title }] });
    setAddDepartmentId("");
  }

  function removeMembership(departmentId: string) {
    update({ memberships: form.memberships.filter((m) => m.departmentId !== departmentId) });
  }

  function setTitle(departmentId: string, title: string) {
    update({ memberships: form.memberships.map((m) => (m.departmentId === departmentId ? { ...m, title } : m)) });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSaved(false);
    const local = validateStaffInput(form, { requireEmail: mode === "create" });
    if (!local.ok) {
      setErrors(local.fieldErrors);
      setFormError("Fix the highlighted fields.");
      return;
    }
    setErrors({});
    startTransition(async () => {
      try {
        const result =
          props.mode === "create" ? await createStaffMember(form) : await updateStaffMember(props.userId, form);
        if (!result.ok) {
          setErrors(result.fieldErrors);
          setFormError(result.formError ?? "Fix the highlighted fields.");
          return;
        }
        if (props.mode === "create") {
          router.push(`/admin/workers/${result.id}?added=1`);
        } else {
          setSaved(true);
          router.refresh();
        }
      } catch {
        setFormError("Couldn't save. Check your connection and try again.");
      }
    });
  }

  const describe = (field: StaffField) => (errors[field] ? `staff-${field}-error` : undefined);
  const invalid = (field: StaffField) => (errors[field] ? true : undefined);

  return (
    <form onSubmit={submit} noValidate className="card-base" aria-label={mode === "create" ? "New staff member" : "Staff record"}>
      <Section title="Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="staff-name">Full name</Label>
            <Input
              id="staff-name"
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              autoComplete="off"
              aria-invalid={invalid("name")}
              aria-describedby={describe("name")}
              className={errors.name ? "border-accent" : undefined}
            />
            <FieldError id="staff-name-error" message={errors.name} />
          </div>
          {mode === "create" && (
            <div className="sm:col-span-2">
              <Label htmlFor="staff-email">Work email</Label>
              <Input
                id="staff-email"
                type="email"
                value={form.email ?? ""}
                onChange={(e) => update({ email: e.target.value })}
                autoComplete="off"
                aria-invalid={invalid("email")}
                aria-describedby={describe("email") ?? "staff-email-hint"}
                className={errors.email ? "border-accent" : undefined}
              />
              {errors.email ? (
                <FieldError id="staff-email-error" message={errors.email} />
              ) : (
                <p id="staff-email-hint" className="mt-1 text-xs text-neutral-500">
                  Their sign-in. It can&apos;t be changed here later.
                </p>
              )}
            </div>
          )}
          <div>
            <Label htmlFor="staff-position">Position</Label>
            <Select
              id="staff-position"
              value={form.position}
              onChange={(e) => update({ position: e.target.value })}
              aria-invalid={invalid("position")}
              aria-describedby={describe("position") ?? (props.legacyPosition ? "staff-position-legacy" : undefined)}
              className={errors.position ? "border-accent" : undefined}
            >
              <option value="">Choose a position</option>
              {POSITIONS.map((p) => (
                <option key={p.code} value={p.label}>
                  {p.label} ({p.code})
                </option>
              ))}
            </Select>
            <FieldError id="staff-position-error" message={errors.position} />
            {!errors.position && props.legacyPosition && form.position === "" && (
              <p id="staff-position-legacy" className="mt-1 text-xs text-amber-800">
                Saved as &ldquo;{props.legacyPosition}&rdquo;, which isn&apos;t a standard position. Pick one.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="staff-employee-id">Employee ID (optional)</Label>
            <Input
              id="staff-employee-id"
              value={form.employeeId}
              onChange={(e) => update({ employeeId: e.target.value })}
              autoComplete="off"
              aria-invalid={invalid("employeeId")}
              aria-describedby={describe("employeeId")}
              className={errors.employeeId ? "border-accent" : undefined}
            />
            <FieldError id="staff-employeeId-error" message={errors.employeeId} />
          </div>
          <div>
            <Label htmlFor="staff-hire-date">Hire date</Label>
            <Input
              id="staff-hire-date"
              type="date"
              value={form.hireDate}
              onChange={(e) => update({ hireDate: e.target.value })}
              aria-invalid={invalid("hireDate")}
              aria-describedby={describe("hireDate")}
              className={errors.hireDate ? "border-accent" : undefined}
            />
            <FieldError id="staff-hireDate-error" message={errors.hireDate} />
          </div>
          <div>
            <Label htmlFor="staff-seniority">Seniority rank (optional)</Label>
            <Input
              id="staff-seniority"
              inputMode="numeric"
              value={form.seniorityRank}
              onChange={(e) => update({ seniorityRank: e.target.value })}
              aria-invalid={invalid("seniorityRank")}
              aria-describedby={describe("seniorityRank") ?? "staff-seniority-hint"}
              className={errors.seniorityRank ? "border-accent" : undefined}
            />
            {errors.seniorityRank ? (
              <FieldError id="staff-seniorityRank-error" message={errors.seniorityRank} />
            ) : (
              <p id="staff-seniority-hint" className="mt-1 text-xs text-neutral-500">
                1 is called first. Blank falls back to hire date.
              </p>
            )}
          </div>
        </div>
        <label className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3">
          <input
            type="checkbox"
            checked={form.isTeamLead}
            onChange={(e) => update({ isTeamLead: e.target.checked })}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-neutral-300 text-primary-700 focus-visible:ring-2 focus-visible:ring-primary-500"
          />
          <span>
            <span className="block text-sm font-medium text-neutral-900">Team Lead</span>
            <span className="block text-xs text-neutral-500">
              A Lead RN / Team Lead tag. It never changes which shifts or callouts they get.
            </span>
          </span>
        </label>
      </Section>

      <Section
        title="Phone"
        description="Text and call alerts go only to a verified number."
      >
        <div className="sm:max-w-xs">
          <Label htmlFor="staff-phone">Mobile number (optional)</Label>
          <Input
            id="staff-phone"
            type="tel"
            placeholder="+14165551234"
            value={form.phone}
            onChange={(e) => update({ phone: e.target.value })}
            autoComplete="off"
            aria-invalid={invalid("phone")}
            aria-describedby={describe("phone")}
            className={errors.phone ? "border-accent" : undefined}
          />
          <FieldError id="staff-phone-error" message={errors.phone} />
        </div>
        {mode === "edit" && props.phoneVerified && initial.phone === form.phone && form.phoneConfirmed && (
          <p className="flex items-center gap-1.5 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Verified
          </p>
        )}
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={form.phoneConfirmed}
            disabled={!form.phone.trim()}
            onChange={(e) => update({ phoneConfirmed: e.target.checked })}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-neutral-300 text-primary-700 focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50"
          />
          <span>
            <span className="block text-sm font-medium text-neutral-900">I confirmed this number with them</span>
            <span className="block text-xs text-neutral-500">
              Turns on text and call alerts now. Leave it unticked and they verify it themselves on their Profile.
            </span>
          </span>
        </label>
      </Section>

      <Section
        title="Departments"
        description="Their departments decide who is called first for a shift, whose schedule they appear on, and who they can swap with."
      >
        {form.memberships.length === 0 ? (
          <p className="text-sm text-neutral-500">Not in any department yet.</p>
        ) : (
          <ul className="space-y-2" aria-label="Department memberships">
            {form.memberships.map((m) => {
              const dept = departmentById.get(m.departmentId);
              const deptName = dept ? dept.name : "Unknown department";
              const titleId = `staff-title-${m.departmentId}`;
              return (
                <li
                  key={m.departmentId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-neutral-200 p-3"
                >
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="text-sm font-semibold text-neutral-900">{deptName}</p>
                    {dept && <p className="text-xs text-neutral-500">{dept.code}</p>}
                    {form.memberships.length > 1 && (
                      <label className="mt-1 inline-flex items-center gap-2 text-xs text-neutral-600">
                        <input
                          type="radio"
                          name="primary-department"
                          checked={
                            form.primaryDepartmentId === m.departmentId ||
                            (!form.memberships.some((x) => x.departmentId === form.primaryDepartmentId) &&
                              form.memberships[0].departmentId === m.departmentId)
                          }
                          onChange={() => update({ primaryDepartmentId: m.departmentId })}
                          className="h-4 w-4 border-neutral-300 text-primary-700"
                        />
                        Main department
                      </label>
                    )}
                  </div>
                  <div className="w-40">
                    <label htmlFor={titleId} className="sr-only">
                      Roster title in {deptName}
                    </label>
                    <Input
                      id={titleId}
                      value={m.title}
                      placeholder="Roster title"
                      onChange={(e) => setTitle(m.departmentId, e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMembership(m.departmentId)}
                    aria-label={`Remove from ${deptName}`}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <FieldError id="staff-memberships-error" message={errors.memberships} />
        {available.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 basis-56 sm:max-w-xs">
              <Label htmlFor="staff-add-department">Add to department</Label>
              <Select
                id="staff-add-department"
                value={addDepartmentId}
                onChange={(e) => setAddDepartmentId(e.target.value)}
              >
                <option value="">Choose a department</option>
                {available.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </Select>
            </div>
            <Button type="button" variant="outline" onClick={addMembership} disabled={!addDepartmentId}>
              <Plus className="h-4 w-4" aria-hidden />
              Add
            </Button>
          </div>
        )}
      </Section>

      <div className="flex flex-col-reverse gap-3 rounded-b-xl border-t border-neutral-100 bg-neutral-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
        <div className="flex-1 text-sm empty:hidden sm:empty:block">
          {formError ? (
            <p role="alert" className="text-accent">
              {formError}
            </p>
          ) : saved ? (
            <p role="status" className="flex items-center gap-1.5 text-emerald-700">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              Changes saved
            </p>
          ) : null}
        </div>
        {mode === "create" && (
          <Link
            href="/admin/workers"
            className="inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            Cancel
          </Link>
        )}
        <Button type="submit" loading={pending}>
          {mode === "create" ? "Add staff member" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
