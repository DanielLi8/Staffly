"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDays, format, isSameMonth, startOfDay } from "date-fns";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { buildAvailabilityRows, type AvailabilityRowDraft } from "@/lib/availability/build";
import { notifyAdminsOfAvailabilityChange, notifyWorkerOfAvailabilityUpdate } from "@/lib/notifications";

const saveAvailabilitySchema = z.object({
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1),
  blocks: z
    .array(
      z.object({
        status: z.enum(["AVAILABLE", "UNAVAILABLE"]),
        from: z.string().min(1),
        to: z.string().min(1),
      })
    )
    .min(1),
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
 * One or more rows per selected day - one per submitted block, each an
 * AVAILABLE or UNAVAILABLE time-of-day range - matching the shape
 * `prisma/seed.ts` already seeds. Re-saving a day replaces whatever was
 * there for it (a day's blocks are always submitted as a full set), so any
 * existing rows for that calendar day are deleted before that day's new
 * rows are created, regardless of which department (if any) they were
 * scoped to. The delete and the day's creates run in the same transaction
 * step so a day with multiple blocks never has an earlier block's insert
 * wiped out by a later block's delete.
 */
export async function saveAvailability(rawInput: unknown): Promise<SaveAvailabilityResult> {
  const session = await requireAuth("STAFF");

  const parsed = saveAvailabilitySchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: "Select at least one day." };
  }
  const { dates, blocks } = parsed.data;

  const days = dates.map(parseDayKey);
  const built = buildAvailabilityRows(days, blocks);
  if (!built.ok) {
    return { ok: false, error: built.error };
  }

  const rowsByDayKey = new Map<string, AvailabilityRowDraft[]>();
  for (const row of built.rows) {
    const key = format(row.day, "yyyy-MM-dd");
    const existing = rowsByDayKey.get(key);
    if (existing) existing.push(row);
    else rowsByDayKey.set(key, [row]);
  }

  await db.$transaction(
    Array.from(rowsByDayKey.values()).flatMap((rows) => {
      const dayStart = startOfDay(rows[0].day);
      const dayEnd = addDays(dayStart, 1);
      return [
        db.availability.deleteMany({
          where: { userId: session.user.id, startsAt: { gte: dayStart, lt: dayEnd } },
        }),
        db.availability.createMany({
          data: rows.map((row) => ({
            userId: session.user.id,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            status: row.status,
          })),
        }),
      ];
    })
  );

  const dateLabel = formatDateLabel(days);
  await notifyWorkerOfAvailabilityUpdate({ workerId: session.user.id, dateLabel });
  await notifyAdminsOfAvailabilityChange({ workerName: session.user.name, dateLabel });

  revalidatePath("/worker/schedule");

  return { ok: true, count: rowsByDayKey.size };
}
