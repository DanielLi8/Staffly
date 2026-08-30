"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDays, format, isSameMonth, startOfDay } from "date-fns";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { buildAvailabilityRows } from "@/lib/availability/build";
import { notifyAdminsOfAvailabilityChange, notifyWorkerOfAvailabilityUpdate } from "@/lib/notifications";

const saveAvailabilitySchema = z.object({
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1),
  status: z.enum(["AVAILABLE", "UNAVAILABLE"]),
  from: z.string().optional(),
  to: z.string().optional(),
});

/**
 * Validation is returned, never thrown - a routine bad input (an unreadable
 * time, no days selected) must not surface as Next.js's opaque server-action
 * "digest" message, same reasoning as `CreateShiftFailure` in
 * `src/app/actions/shifts.ts`.
 */
export type SaveAvailabilityResult = { ok: true; count: number } | { ok: false; error: string };

function parseDayKey(dayKey: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateLabel(days: Date[]): string {
  const sorted = [...days].sort((a, b) => a.getTime() - b.getTime());
  const allSameMonth = sorted.every((d) => isSameMonth(d, sorted[0]));
  if (allSameMonth) {
    return `${format(sorted[0], "MMM")} ${sorted.map((d) => format(d, "d")).join(", ")}`;
  }
  return sorted.map((d) => format(d, "MMM d")).join(", ");
}

/**
 * One row per selected day, sharing one action: a single AVAILABLE time
 * range, or a flat UNAVAILABLE covering the whole day - matching the shape
 * `prisma/seed.ts` already seeds. Re-saving a day replaces whatever was
 * there for it (a day has exactly one availability state at a time), so any
 * existing rows for that calendar day are deleted before the new one is
 * created, regardless of which department (if any) they were scoped to.
 */
export async function saveAvailability(rawInput: unknown): Promise<SaveAvailabilityResult> {
  const session = await requireAuth("STAFF");

  const parsed = saveAvailabilitySchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: "Select at least one day." };
  }
  const { dates, status, from, to } = parsed.data;

  const days = dates.map(parseDayKey);
  const built = buildAvailabilityRows(
    days,
    status,
    status === "AVAILABLE" ? { from: from ?? "", to: to ?? "" } : undefined
  );
  if (!built.ok) {
    return { ok: false, error: built.error };
  }

  await db.$transaction(
    built.rows.flatMap((row) => {
      const dayStart = startOfDay(row.day);
      const dayEnd = addDays(dayStart, 1);
      return [
        db.availability.deleteMany({
          where: { userId: session.user.id, startsAt: { gte: dayStart, lt: dayEnd } },
        }),
        db.availability.create({
          data: {
            userId: session.user.id,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            status: row.status,
          },
        }),
      ];
    })
  );

  const dateLabel = formatDateLabel(built.rows.map((r) => r.day));
  await notifyWorkerOfAvailabilityUpdate({ workerId: session.user.id, dateLabel });
  await notifyAdminsOfAvailabilityChange({ workerName: session.user.name, dateLabel });

  revalidatePath("/worker/schedule");

  return { ok: true, count: built.rows.length };
}
