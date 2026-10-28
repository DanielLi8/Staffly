"use server";

/**
 * Staffing targets page actions (`/admin/departments/[id]/targets`). The
 * targets page is the ONLY place projected numbers are edited (captain
 * decision projected-edit-scope); every other surface shows them read-only.
 *
 * ADMIN only via `requireActor("ADMIN")`, which throws for auth like every
 * other action. Bad input and routine races come back as a typed
 * `StaffingResult`, never a throw (CLAUDE.md "Server-action validation").
 * The DB work, locking and audit rows live in `src/lib/staffing/store.ts`.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import {
  applySundayNumbers as applySundayNumbersInStore,
  removeTargetOverride as removeTargetOverrideInStore,
  saveWeeklyTargets as saveWeeklyTargetsInStore,
  setShiftPattern as setShiftPatternInStore,
  setTargetOverride as setTargetOverrideInStore,
  updateShiftTemplate as updateShiftTemplateInStore,
  type StaffingResult,
} from "@/lib/staffing/store";
import { DAYS_OF_WEEK, MAX_OVERRIDE_REASON_LENGTH, MAX_TARGET_COUNT, isDayKey } from "@/lib/staffing/targets";
import { STAFFING_ROLES } from "@/lib/staffing/roles";
import { SHIFT_PATTERNS, TEMPLATE_TIMES_MESSAGE, validateTemplateTimes } from "@/lib/staffing/templates";

const id = z.string().min(1);
const count = z
  .number({ invalid_type_error: "Enter a whole number." })
  .int("Enter a whole number.")
  .min(0, "A target can't be below 0.")
  .max(MAX_TARGET_COUNT, `A target can't be above ${MAX_TARGET_COUNT}.`);
const role = z.enum(STAFFING_ROLES as [(typeof STAFFING_ROLES)[number], ...(typeof STAFFING_ROLES)[number][]]);
const day = z.enum(DAYS_OF_WEEK as [(typeof DAYS_OF_WEEK)[number], ...(typeof DAYS_OF_WEEK)[number][]]);
const pattern = z.enum(SHIFT_PATTERNS as [(typeof SHIFT_PATTERNS)[number], ...(typeof SHIFT_PATTERNS)[number][]]);
const dayKey = z.string().refine(isDayKey, "Pick a valid date.");
const reason = z
  .string()
  .trim()
  .max(MAX_OVERRIDE_REASON_LENGTH, `Keep the reason under ${MAX_OVERRIDE_REASON_LENGTH} characters.`)
  .nullish()
  .transform((r) => (r ? r : null));

const saveWeeklySchema = z.object({
  departmentId: id,
  changes: z
    .array(
      z
        .object({
          templateId: id,
          role,
          days: z.array(day).min(1).max(7),
          before: z.array(count),
          count,
        })
        .refine((c) => c.before.length === c.days.length && new Set(c.days).size === c.days.length, "Bad change.")
    )
    .min(1, "Nothing to save."),
});

const setOverrideSchema = z.object({
  templateId: id,
  date: dayKey,
  role,
  count,
  reason,
  expected: count.nullable(),
});

const removeOverrideSchema = z.object({ overrideId: id });

const sundayNumbersSchema = z.object({ departmentId: id, date: dayKey, reason });

const templateTimes = z.object({
  startMinute: z.number().int(),
  endMinute: z.number().int(),
  leadRequired: z.boolean(),
});
const updateTemplateSchema = z.object({ templateId: id, before: templateTimes, after: templateTimes });

const setPatternSchema = z.object({ departmentId: id, from: pattern, to: pattern });

function invalid(error: z.ZodError): StaffingResult {
  return { ok: false, reason: "INVALID", message: error.issues[0]?.message ?? "Check the values and try again." };
}

function settle(result: StaffingResult): StaffingResult {
  if (result.ok) {
    revalidatePath("/admin/departments/[id]/targets", "page");
    revalidatePath("/admin/staffing-targets");
  }
  return result;
}

/** Save the weekly matrix: each change sets one shift x role to `count` on `days`. */
export async function saveWeeklyTargets(raw: unknown): Promise<StaffingResult> {
  const actor = await requireActor("ADMIN");
  const parsed = saveWeeklySchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  return settle(await saveWeeklyTargetsInStore(actor.id, parsed.data));
}

/** Set one date's number for a shift x role (back to the usual number removes the override). */
export async function setTargetOverride(raw: unknown): Promise<StaffingResult> {
  const actor = await requireActor("ADMIN");
  const parsed = setOverrideSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  return settle(await setTargetOverrideInStore(actor.id, parsed.data));
}

export async function removeTargetOverride(raw: unknown): Promise<StaffingResult> {
  const actor = await requireActor("ADMIN");
  const parsed = removeOverrideSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  return settle(await removeTargetOverrideInStore(actor.id, parsed.data));
}

/** Holiday shortcut: every shift and role on the date uses the Sunday numbers. */
export async function applySundayNumbers(raw: unknown): Promise<StaffingResult> {
  const actor = await requireActor("ADMIN");
  const parsed = sundayNumbersSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  return settle(await applySundayNumbersInStore(actor.id, parsed.data));
}

export async function updateShiftTemplate(raw: unknown): Promise<StaffingResult> {
  const actor = await requireActor("ADMIN");
  const parsed = updateTemplateSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const timesError = validateTemplateTimes(parsed.data.after.startMinute, parsed.data.after.endMinute);
  if (timesError) return { ok: false, reason: "INVALID", message: TEMPLATE_TIMES_MESSAGE[timesError] };
  return settle(await updateShiftTemplateInStore(actor.id, parsed.data));
}

/** Switch a department between 8-hour (D/E/N) and 12-hour (D/N) shifts. */
export async function setShiftPattern(raw: unknown): Promise<StaffingResult> {
  const actor = await requireActor("ADMIN");
  const parsed = setPatternSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  return settle(await setShiftPatternInStore(actor.id, parsed.data));
}
