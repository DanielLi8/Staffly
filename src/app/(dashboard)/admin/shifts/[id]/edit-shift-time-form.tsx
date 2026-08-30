"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { editShiftTime } from "@/app/actions/shifts";
import { formatShiftRange } from "@/lib/utils";
import { combineDateAndTime, formatDateInput, formatTimeInput } from "@/lib/shifts/time";
import { SHIFT_TIME_MESSAGES, type ShiftFieldErrors } from "@/lib/shifts/validation";

const UNREADABLE_TIME = "Enter a time like 7:00 AM";

interface EditShiftTimeFormProps {
  shiftId: string;
  startsAt: Date;
  endsAt: Date;
}

export function EditShiftTimeForm({ shiftId, startsAt, endsAt }: EditShiftTimeFormProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [errors, setErrors] = useState<ShiftFieldErrors>({});
  const [startDate, setStartDate] = useState(formatDateInput(startsAt));
  const [startTime, setStartTime] = useState(formatTimeInput(startsAt));
  const [endDate, setEndDate] = useState(formatDateInput(endsAt));
  const [endTime, setEndTime] = useState(formatTimeInput(endsAt));

  function startEditing() {
    setStartDate(formatDateInput(startsAt));
    setStartTime(formatTimeInput(startsAt));
    setEndDate(formatDateInput(endsAt));
    setEndTime(formatTimeInput(endsAt));
    setErrors({});
    setFormError("");
    setEditing(true);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError("");

    const nextStartsAt = combineDateAndTime(startDate, startTime);
    const nextEndsAt = combineDateAndTime(endDate, endTime);

    const nextErrors: ShiftFieldErrors = {};
    if (!nextStartsAt) nextErrors.startsAt = UNREADABLE_TIME;
    if (!nextEndsAt) nextErrors.endsAt = UNREADABLE_TIME;
    if (nextStartsAt && nextEndsAt && nextEndsAt <= nextStartsAt) {
      nextErrors.endsAt = SHIFT_TIME_MESSAGES.endBeforeStart;
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setLoading(true);

    const result = await editShiftTime({ shiftId, startsAt: nextStartsAt, endsAt: nextEndsAt });

    if (result.ok) {
      setEditing(false);
      setLoading(false);
      router.refresh();
    } else {
      setErrors(result.fieldErrors);
      if (result.formError) setFormError(result.formError);
      setLoading(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span>{formatShiftRange(startsAt, endsAt)}</span>
        <button
          type="button"
          onClick={startEditing}
          className="text-neutral-400 hover:text-primary-700 transition-colors"
          aria-label="Edit shift hours"
        >
          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {formError && (
        <p role="alert" className="text-xs text-accent">
          {formError}
        </p>
      )}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <Label htmlFor="edit-startsAt-date" className="text-[11px]">Starts</Label>
          <div className="flex gap-1.5">
            <Input
              id="edit-startsAt-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
            <Input
              id="edit-startsAt-time"
              type="text"
              autoComplete="off"
              placeholder="7:00 AM"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              aria-label="Start time"
              className="w-[7.5rem] shrink-0"
              required
            />
          </div>
          {errors.startsAt && <p className="mt-1 text-xs text-accent">{errors.startsAt}</p>}
        </div>
      </div>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <Label htmlFor="edit-endsAt-date" className="text-[11px]">Ends</Label>
          <div className="flex gap-1.5">
            <Input
              id="edit-endsAt-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
            <Input
              id="edit-endsAt-time"
              type="text"
              autoComplete="off"
              placeholder="7:00 PM"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              aria-label="End time"
              className="w-[7.5rem] shrink-0"
              required
            />
          </div>
          {errors.endsAt && <p className="mt-1 text-xs text-accent">{errors.endsAt}</p>}
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={loading}>
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
