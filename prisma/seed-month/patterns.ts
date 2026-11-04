/**
 * Department shift patterns and roster sizing for the month demo-data
 * generator (`pnpm seed:month`). PURE: no DB.
 *
 * The patterns follow what the app already assumes: 8 h Days / Evenings /
 * Nights on the classifyShiftType boundaries (07-15, 15-23, 23-07) by default,
 * and 12 h Days / Nights (07-19, 19-07 - the availability editor's "Days" and
 * "Nights" presets) for the units that run 12s. A department code with no
 * entry here gets DEFAULT_PATTERN, so every department gets shifts.
 */
import type { StaffingRole } from "@/lib/roles/staffing-role";

export type ShiftKind = "DAY" | "EVENING" | "NIGHT";

export interface ShiftTemplate {
  kind: ShiftKind;
  /** Minutes after hospital-local midnight. */
  startMinute: number;
  hours: number;
  /** Headcount per counting role on this shift. */
  needs: Partial<Record<StaffingRole, number>>;
}

export interface DepartmentPattern {
  unit: string;
  location: string;
  shifts: ShiftTemplate[];
}

const ST_MICHAELS = "St. Michael's Hospital – 30 Bond St.";
const ST_JOSEPHS = "St. Joseph's Health Centre – 30 The Queensway";

const day8 = (needs: ShiftTemplate["needs"]): ShiftTemplate => ({ kind: "DAY", startMinute: 7 * 60, hours: 8, needs });
const eve8 = (needs: ShiftTemplate["needs"]): ShiftTemplate => ({ kind: "EVENING", startMinute: 15 * 60, hours: 8, needs });
const night8 = (needs: ShiftTemplate["needs"]): ShiftTemplate => ({ kind: "NIGHT", startMinute: 23 * 60, hours: 8, needs });
const day12 = (needs: ShiftTemplate["needs"]): ShiftTemplate => ({ kind: "DAY", startMinute: 7 * 60, hours: 12, needs });
const night12 = (needs: ShiftTemplate["needs"]): ShiftTemplate => ({ kind: "NIGHT", startMinute: 19 * 60, hours: 12, needs });

export const DEFAULT_PATTERN: DepartmentPattern = {
  unit: "2A",
  location: ST_MICHAELS,
  shifts: [day8({ RN: 1, RPN: 1, PSW: 1 }), eve8({ RN: 1, PSW: 1 }), night8({ RN: 1 })],
};

export const DEPARTMENT_PATTERNS: Record<string, DepartmentPattern> = {
  ER: { unit: "4B", location: ST_MICHAELS, shifts: [day12({ RN: 2, RPN: 1, PSW: 1 }), night12({ RN: 2, PSW: 1 })] },
  ICU: { unit: "3A", location: ST_MICHAELS, shifts: [day12({ RN: 2 }), night12({ RN: 2 })] },
  MED: {
    unit: "5C",
    location: ST_JOSEPHS,
    shifts: [day8({ RN: 1, RPN: 1, PSW: 1 }), eve8({ RN: 1, RPN: 1, PSW: 1 }), night8({ RN: 1, PSW: 1 })],
  },
  PED: { unit: "6A", location: ST_MICHAELS, shifts: [day8({ RN: 1, RPN: 1 }), eve8({ RN: 1, RPN: 1 }), night8({ RN: 1 })] },
  SURG: { unit: "7B", location: ST_MICHAELS, shifts: [day8({ RN: 2, PSW: 1 }), eve8({ RN: 1, PSW: 1 }), night8({ RN: 1 })] },
  RAD: { unit: "B1", location: ST_MICHAELS, shifts: [day8({ RN: 1 }), eve8({ RN: 1 })] },
};

export function patternFor(code: string): DepartmentPattern {
  return DEPARTMENT_PATTERNS[code.toUpperCase()] ?? DEFAULT_PATTERN;
}

/** Pay-period hours a full-time / part-time line is rostered up to (both under the 75 h line). */
export const FULL_TIME_HOURS = 72;
export const PART_TIME_HOURS = 48;
/** Share of staff on a full-time line. */
export const FULL_TIME_SHARE = 0.75;

/**
 * How many people of `role` a department needs on its roster so a 14-day pay
 * period can be covered with straight-time lines, allowing for rest rules,
 * rotation and vacation (the 0.85 efficiency) and for the ~8% of slots the
 * generator leaves as holes on purpose.
 */
export function rosterTarget(pattern: DepartmentPattern, role: StaffingRole): number {
  let slotsPerPeriod = 0;
  let hours = 8;
  for (const s of pattern.shifts) {
    const n = s.needs[role] ?? 0;
    slotsPerPeriod += n * 14;
    if (n > 0) hours = s.hours;
  }
  if (slotsPerPeriod === 0) return 0;
  const fullTimeShifts = Math.floor(FULL_TIME_HOURS / hours);
  const partTimeShifts = Math.floor(PART_TIME_HOURS / hours);
  const perPerson = FULL_TIME_SHARE * fullTimeShifts + (1 - FULL_TIME_SHARE) * partTimeShifts;
  return Math.ceil((slotsPerPeriod * 0.93) / (perPerson * 0.85));
}
