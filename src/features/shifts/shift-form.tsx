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
import { format } from "date-fns";

const ROLES = [
  "Registered Nurse (RN)",
  "Certified Nursing Assistant (CNA)",
  "Registered Practical Nurse (RPN)",
  "Emergency MD",
  "Trauma Surgeon",
  "Respiratory Therapist",
];

function toLocalDateTimeValue(d: Date) {
  return format(d, "yyyy-MM-dd'T'HH:mm");
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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const now = new Date();
  const defaultStart = new Date(now.getTime() + 60 * 60 * 1000);
  const defaultEnd = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const defaultDeadline = new Date(now.getTime() + 30 * 60 * 1000);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const form = e.currentTarget;
    const data = new FormData(form);

    try {
      await createShift({
        unit: data.get("unit"),
        departmentId: data.get("departmentId"),
        roleNeeded: data.get("roleNeeded"),
        location: data.get("location"),
        startsAt: data.get("startsAt"),
        endsAt: data.get("endsAt"),
        bidDeadlineAt: data.get("bidDeadlineAt"),
        notes: data.get("notes") || undefined,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message !== "NEXT_REDIRECT") {
        setError(err.message || "Failed to create shift. Please try again.");
      }
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div role="alert" className="px-4 py-3 bg-accent-50 border border-accent-200 rounded-lg text-sm text-accent-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <Label htmlFor="departmentId" className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
            Unit / Department
          </Label>
          <Select id="departmentId" name="departmentId" required className="mt-1.5">
            <option value="">Select department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.code})
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">Role needed</Label>
          <Select id="roleNeeded" name="roleNeeded" required className="mt-1.5">
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
        <Label className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">Unit / floor</Label>
        <Input
          id="unit"
          name="unit"
          placeholder="e.g. 4B"
          required
          className="mt-1.5"
        />
      </div>

      <div>
        <Label className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">Specific location</Label>
        <div className="relative mt-1.5">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" aria-hidden />
          <Input
            id="location"
            name="location"
            placeholder="Building B, Floor 4, Nurse Station 2"
            required
            className="pl-10"
          />
        </div>
      </div>

      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500 mb-3">Time & deadlines</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="startsAt">Start time & date</Label>
            <Input
              id="startsAt"
              name="startsAt"
              type="datetime-local"
              defaultValue={toLocalDateTimeValue(defaultStart)}
              required
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="endsAt">End time & date</Label>
            <Input
              id="endsAt"
              name="endsAt"
              type="datetime-local"
              defaultValue={toLocalDateTimeValue(defaultEnd)}
              required
              className="mt-1.5"
            />
          </div>
        </div>
        <div className="mt-4">
          <Label htmlFor="bidDeadlineAt">Bid deadline</Label>
          <Input
            id="bidDeadlineAt"
            name="bidDeadlineAt"
            type="datetime-local"
            defaultValue={toLocalDateTimeValue(defaultDeadline)}
            required
            className="mt-1.5"
          />
          <p className="mt-1.5 text-xs italic text-neutral-500">
            Bids must be submitted at least 4 hours before the shift starts.
          </p>
        </div>
      </div>

      <div>
        <Label className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">Administrative notes</Label>
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
