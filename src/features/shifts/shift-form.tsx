"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { createShift } from "@/app/actions/shifts";
import { addDays, startOfDay, subHours } from "date-fns";
import {
  combineDateAndTime,
  formatDateInput,
  formatTimeInput,
} from "@/lib/shifts/time";
import { validateShiftTimes, type ShiftFieldErrors } from "@/lib/shifts/validation";

const ROLES = [
  "Registered Nurse (RN)",
  "Certified Nursing Assistant (CNA)",
  "Registered Practical Nurse (RPN)",
  "Emergency MD",
  "Trauma Surgeon",
  "Respiratory Therapist",
];

/** Typed into the free-text time fields; also drives the `list` suggestions. */
const TIME_SUGGESTIONS = ["7:00 AM", "11:00 AM", "3:00 PM", "7:00 PM", "11:00 PM"];

const UNREADABLE_TIME = "Enter a time like 7:00 AM";

/**
 * Defaults are a standard 07:00–19:00 day shift on the next day, with the bid
 * deadline 12 hours ahead of the start so the form opens in a valid state.
 */
function defaultTimes() {
  const start = new Date(startOfDay(addDays(new Date(), 1)).getTime() + 7 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 12 * 60 * 60 * 1000);
  const deadline = subHours(start, 12);
  return {
    startDate: formatDateInput(start),
    startTime: formatTimeInput(start),
    endDate: formatDateInput(end),
    endTime: formatTimeInput(end),
    deadlineDate: formatDateInput(deadline),
    deadlineTime: formatTimeInput(deadline),
  };
}

export interface DepartmentOption {
  id: string;
  name: string;
  code: string;
}

interface ShiftFormProps {
  departments: DepartmentOption[];
}

export function ShiftForm({ departments }: ShiftFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState("");
  const [errors, setErrors] = useState<ShiftFieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [times, setTimes] = useState(defaultTimes);

  function updateTime(patch: Partial<ReturnType<typeof defaultTimes>>) {
    setTimes((prev) => ({ ...prev, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError("");

    const startsAt = combineDateAndTime(times.startDate, times.startTime);
    const endsAt = combineDateAndTime(times.endDate, times.endTime);
    const bidDeadlineAt = combineDateAndTime(times.deadlineDate, times.deadlineTime);

    // Client-side guard: an invalid submit never reaches the server, so it can
    // never come back as the sanitized "digest" error.
    const nextErrors: ShiftFieldErrors = {};
    if (!startsAt) nextErrors.startsAt = UNREADABLE_TIME;
    if (!endsAt) nextErrors.endsAt = UNREADABLE_TIME;
    if (!bidDeadlineAt) nextErrors.bidDeadlineAt = UNREADABLE_TIME;

    if (startsAt && endsAt && bidDeadlineAt) {
      Object.assign(nextErrors, validateShiftTimes({ startsAt, endsAt, bidDeadlineAt }));
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setLoading(true);

    const form = e.currentTarget;
    const data = new FormData(form);

    try {
      const result = await createShift({
        unit: data.get("unit"),
        departmentId: data.get("departmentId"),
        roleNeeded: data.get("roleNeeded"),
        location: data.get("location"),
        startsAt,
        endsAt,
        bidDeadlineAt,
        notes: data.get("notes") || undefined,
      });

      // A successful create redirects, so anything returned is a validation failure.
      if (result && result.ok === false) {
        setErrors(result.fieldErrors);
        if (result.formError) setFormError(result.formError);
        setLoading(false);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message !== "NEXT_REDIRECT") {
        setFormError("Failed to create shift. Please try again.");
      }
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {formError && (
        <div role="alert" className="px-4 py-3 bg-accent-50 border border-accent-200 rounded-lg text-sm text-accent-700">
          {formError}
        </div>
      )}

      <datalist id="shift-time-options">
        {TIME_SUGGESTIONS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <Label htmlFor="departmentId" className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
            Unit / Department
          </Label>
          <Select id="departmentId" name="departmentId" required className="mt-1.5" error={errors.departmentId}>
            <option value="">Select department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.code})
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="roleNeeded" className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
            Role needed
          </Label>
          <Select id="roleNeeded" name="roleNeeded" required className="mt-1.5" error={errors.roleNeeded}>
            <option value="">Select role</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="unit" className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
          Unit / floor
        </Label>
        <Input
          id="unit"
          name="unit"
          placeholder="e.g. 4B"
          required
          className="mt-1.5"
          error={errors.unit}
        />
      </div>

      <div>
        <Label htmlFor="location" className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
          Specific location
        </Label>
        <div className="relative mt-1.5">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" aria-hidden />
          <Input
            id="location"
            name="location"
            placeholder="Building B, Floor 4, Nurse Station 2"
            required
            className="pl-10"
            error={errors.location}
          />
        </div>
      </div>

      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500 mb-3">Time &amp; deadlines</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DateTimeField
            label="Shift starts"
            idPrefix="startsAt"
            dateValue={times.startDate}
            timeValue={times.startTime}
            onDateChange={(v) => updateTime({ startDate: v })}
            onTimeChange={(v) => updateTime({ startTime: v })}
            error={errors.startsAt}
          />
          <DateTimeField
            label="Shift ends"
            idPrefix="endsAt"
            dateValue={times.endDate}
            timeValue={times.endTime}
            onDateChange={(v) => updateTime({ endDate: v })}
            onTimeChange={(v) => updateTime({ endTime: v })}
            error={errors.endsAt}
          />
        </div>

        <div className="mt-4">
          <div className="sm:max-w-[calc(50%-0.5rem)]">
            <DateTimeField
              label="Bid deadline"
              idPrefix="bidDeadlineAt"
              dateValue={times.deadlineDate}
              timeValue={times.deadlineTime}
              onDateChange={(v) => updateTime({ deadlineDate: v })}
              onTimeChange={(v) => updateTime({ deadlineTime: v })}
              error={errors.bidDeadlineAt}
            />
          </div>
          <p className="mt-1.5 text-xs italic text-neutral-500">
            Bids must be submitted at least 4 hours before the shift starts. Times can be
            typed directly, e.g. 7:00 AM.
          </p>
        </div>
      </div>

      <div>
        <Label htmlFor="notes" className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
          Administrative notes
        </Label>
        <Textarea
          id="notes"
          name="notes"
          placeholder="Mention specific equipment needs, patient acuity details, or reporting protocols..."
          rows={4}
          className="mt-1.5"
        />
      </div>

      <div className="flex gap-3 justify-end pt-2">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" loading={loading} className="min-w-[140px]">
          Submit Shift
        </Button>
      </div>
    </form>
  );
}

interface DateTimeFieldProps {
  label: string;
  idPrefix: string;
  dateValue: string;
  timeValue: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  error?: string;
}

/**
 * A date input paired with a typeable AM/PM time box. `datetime-local` was
 * replaced because its scrolling time picker is slow for schedulers who
 * already know the time they want.
 */
function DateTimeField({
  label,
  idPrefix,
  dateValue,
  timeValue,
  onDateChange,
  onTimeChange,
  error,
}: DateTimeFieldProps) {
  const errorId = `${idPrefix}-error`;

  return (
    <div>
      <Label htmlFor={`${idPrefix}-date`}>{label}</Label>
      <div className="mt-1.5 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <Input
            id={`${idPrefix}-date`}
            name={`${idPrefix}Date`}
            type="date"
            value={dateValue}
            onChange={(e) => onDateChange(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={error ? "border-accent" : undefined}
            required
          />
        </div>
        <div className="w-[8.5rem] shrink-0">
          <Input
            id={`${idPrefix}-time`}
            name={`${idPrefix}Time`}
            type="text"
            autoComplete="off"
            list="shift-time-options"
            placeholder="7:00 AM"
            value={timeValue}
            onChange={(e) => onTimeChange(e.target.value)}
            aria-label={`${label} time`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={error ? "border-accent" : undefined}
            required
          />
        </div>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-accent">
          {error}
        </p>
      )}
    </div>
  );
}
