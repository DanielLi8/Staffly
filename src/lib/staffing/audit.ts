import type { DayOfWeek, ShiftPattern, StaffingRole } from "@prisma/client";
import { format } from "date-fns";
import { dayKeyToLocalDate } from "@/lib/timezone";
import { DAY_SHORT_LABEL, DISPLAY_DAYS, WEEKDAYS, WEEKEND_DAYS } from "./targets";
import { STAFFING_ROLE_LABEL } from "./roles";
import { SHIFT_PATTERN_LABEL, formatTemplateRange, templateDisplayName } from "./templates";

/**
 * Audit trail for staffing-target changes. Every write on the targets page
 * records one `AuditLog` row (who = `actorId`, when = `createdAt`) with
 * `targetType = "Department"` and a self-describing `metadata` payload, so a
 * history line still reads correctly after the template is renamed or
 * retimed. PURE apart from the types: the actions build these, the page
 * renders them through `describeStaffingAudit`.
 */

export const STAFFING_AUDIT_TARGET_TYPE = "Department";

export const STAFFING_AUDIT_ACTIONS = [
  "STAFFING_TARGET_CHANGED",
  "STAFFING_OVERRIDE_SET",
  "STAFFING_OVERRIDE_REMOVED",
  "SHIFT_TEMPLATE_CHANGED",
  "SHIFT_PATTERN_CHANGED",
] as const;

export type StaffingAuditAction = (typeof STAFFING_AUDIT_ACTIONS)[number];

interface TemplateRef {
  templateId: string;
  templateCode: string;
  templateLabel: string;
  templatePattern: ShiftPattern;
}

export interface TargetChangedMetadata extends TemplateRef {
  role: StaffingRole;
  days: DayOfWeek[];
  /** Per day, aligned with `days`. */
  before: number[];
  after: number;
}

export interface OverrideSetMetadata extends TemplateRef {
  role: StaffingRole;
  date: string;
  /** The previous override for that date, or null if there was none. */
  before: number | null;
  after: number;
  usual: number;
  reason: string | null;
}

export interface OverrideRemovedMetadata extends TemplateRef {
  role: StaffingRole;
  date: string;
  before: number;
  usual: number;
  reason: string | null;
}

export interface TemplateTimes {
  startMinute: number;
  endMinute: number;
  leadRequired: boolean;
}

export interface TemplateChangedMetadata extends TemplateRef {
  before: TemplateTimes;
  after: TemplateTimes;
}

export interface PatternChangedMetadata {
  before: ShiftPattern;
  after: ShiftPattern;
}

export type StaffingAuditEntry =
  | { action: "STAFFING_TARGET_CHANGED"; metadata: TargetChangedMetadata }
  | { action: "STAFFING_OVERRIDE_SET"; metadata: OverrideSetMetadata }
  | { action: "STAFFING_OVERRIDE_REMOVED"; metadata: OverrideRemovedMetadata }
  | { action: "SHIFT_TEMPLATE_CHANGED"; metadata: TemplateChangedMetadata }
  | { action: "SHIFT_PATTERN_CHANGED"; metadata: PatternChangedMetadata };

export function templateRef(t: { id: string; code: string; label: string; pattern: ShiftPattern }): TemplateRef {
  return { templateId: t.id, templateCode: t.code, templateLabel: t.label, templatePattern: t.pattern };
}

const sameDays = (a: readonly DayOfWeek[], b: readonly DayOfWeek[]) =>
  a.length === b.length && b.every((d) => a.includes(d));

/** "Weekdays", "Weekends", "Every day", or "Mon, Wed". */
export function describeDays(days: readonly DayOfWeek[]): string {
  if (sameDays(days, DISPLAY_DAYS)) return "Every day";
  if (sameDays(days, WEEKDAYS)) return "Weekdays";
  if (sameDays(days, WEEKEND_DAYS)) return "Weekends";
  return DISPLAY_DAYS.filter((d) => days.includes(d)).map((d) => DAY_SHORT_LABEL[d]).join(", ");
}

/** "Sat, Oct 31". */
export function formatDayKey(dayKey: string): string {
  return format(dayKeyToLocalDate(dayKey), "EEE, MMM d");
}

function shiftName(m: TemplateRef): string {
  return templateDisplayName({ label: m.templateLabel, pattern: m.templatePattern });
}

/** One plain-language line per audit row, for the page's change history. */
export function describeStaffingAudit(entry: StaffingAuditEntry): string {
  switch (entry.action) {
    case "STAFFING_TARGET_CHANGED": {
      const m = entry.metadata;
      const from = m.before.every((v) => v === m.before[0]) ? String(m.before[0] ?? 0) : "varied";
      return `${shiftName(m)} ${STAFFING_ROLE_LABEL[m.role]}, ${describeDays(m.days)}: ${from} → ${m.after}`;
    }
    case "STAFFING_OVERRIDE_SET": {
      const m = entry.metadata;
      const from = m.before ?? m.usual;
      const reason = m.reason ? ` (${m.reason})` : "";
      return `${shiftName(m)} ${STAFFING_ROLE_LABEL[m.role]} on ${formatDayKey(m.date)}: ${from} → ${m.after}, usually ${m.usual}${reason}`;
    }
    case "STAFFING_OVERRIDE_REMOVED": {
      const m = entry.metadata;
      return `${shiftName(m)} ${STAFFING_ROLE_LABEL[m.role]} on ${formatDayKey(m.date)}: back to the usual ${m.usual} (was ${m.before})`;
    }
    case "SHIFT_TEMPLATE_CHANGED": {
      const m = entry.metadata;
      const parts: string[] = [];
      if (m.before.startMinute !== m.after.startMinute || m.before.endMinute !== m.after.endMinute) {
        parts.push(`${formatTemplateRange(m.before)} → ${formatTemplateRange(m.after)}`);
      }
      if (m.before.leadRequired !== m.after.leadRequired) {
        parts.push(m.after.leadRequired ? "Team Lead required" : "Team Lead no longer required");
      }
      return `${shiftName(m)} shift: ${parts.join(", ")}`;
    }
    case "SHIFT_PATTERN_CHANGED":
      return `Switched from ${SHIFT_PATTERN_LABEL[entry.metadata.before].toLowerCase()} to ${SHIFT_PATTERN_LABEL[entry.metadata.after].toLowerCase()}`;
  }
}

export function isStaffingAuditAction(action: string): action is StaffingAuditAction {
  return (STAFFING_AUDIT_ACTIONS as readonly string[]).includes(action);
}
