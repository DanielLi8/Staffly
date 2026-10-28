import type { AvailabilityRowLike } from "@/lib/availability/blocks";
import type { HoursWindow } from "./hours";

/**
 * Why a person is being put on a shift, which decides how strict the rules
 * are (decision `double-booking-override`):
 *
 * - `PLANNING`: drafting a schedule and publishing it (initial assignment).
 *   No double booking and no overtime at all.
 * - `AWARD`: staffing awards an open shift (bid award, booking from the
 *   department view). Double booking allowed with a reason; overtime allowed.
 * - `POST_PUBLISH_OVERRIDE`: an admin changes a schedule after it is posted.
 *   Same allowances as `AWARD`.
 *
 * A true time overlap is blocked in every context.
 */
export type ScheduleContext = "PLANNING" | "AWARD" | "POST_PUBLISH_OVERRIDE";

/**
 * - `BLOCK`: can't be saved, whatever the reason.
 * - `NEEDS_REASON`: can be saved once the admin records a reason.
 * - `HEADS_UP`: can be saved; show it.
 */
export type Severity = "BLOCK" | "NEEDS_REASON" | "HEADS_UP";

export type ScheduleRule =
  | "IN_PAST"
  | "SHIFT_CLOSED"
  | "ROLE_MISMATCH"
  | "OVERLAP"
  | "UNAVAILABLE"
  | "TIME_OFF"
  | "REST_GAP"
  | "PAY_PERIOD_HOURS"
  | "CONSECUTIVE_DAYS"
  | "OUTSIDE_AVAILABILITY"
  | "NOT_DEPARTMENT_MEMBER";

/** One of the person's shifts, or the shift being filled. */
export interface ScheduleShift extends HoursWindow {
  id?: string;
  /** A `CANCELLED` shift is ignored, wherever the caller got it from. */
  status?: string;
  departmentId?: string;
  /** Named in messages: "Overlaps Day 07-15 Mon Oct 26 (Surgery)". */
  departmentName?: string | null;
}

export interface CandidateShift extends ScheduleShift {
  roleNeeded: string;
}

/**
 * Approved time off - the hook for the time-off feature, which doesn't exist
 * yet. Only `APPROVED` rows block; callers pass `[]` until it lands.
 */
export interface TimeOffLike extends HoursWindow {
  status: string;
}

export interface SchedulePerson {
  /** `User.position`. Blank fails closed (never matches a role). */
  position: string | null;
  /** Department memberships; omit to skip the float heads-up. */
  departmentIds?: string[];
  /**
   * Every shift the person already holds, in EVERY department (published and,
   * for the planner, draft): at least the candidate's pay period plus a day
   * either side for rest gaps, and a week either side for the consecutive-day
   * streak. The candidate itself is ignored by id.
   */
  shifts: ScheduleShift[];
  availability?: AvailabilityRowLike[];
  timeOff?: TimeOffLike[];
}

export interface ScheduleIssue {
  rule: ScheduleRule;
  severity: Severity;
  /** Admin-facing sentence, e.g. "Overlaps Day 07-15 Mon Oct 26 (Surgery)". */
  message: string;
  /** The other shift involved (OVERLAP, REST_GAP), when it has an id. */
  relatedShiftId?: string;
}

export type PayType = "STRAIGHT" | "OVERTIME";

export interface PayTypeClassification {
  payType: PayType;
  /** "Straight time" | "Overtime". */
  label: string;
  /**
   * Overtime hours this shift adds: the whole shift when it is a back-to-back
   * double, otherwise the hours it takes the person past the pay-period line
   * (0 when it lands exactly on the line - still overtime, since reaching the
   * line counts).
   */
  overtimeHours: number;
  /**
   * Why, in words; the first one is the headline. Straight time:
   * ["40 → 48 h of 75 h - pay period Oct 18-31"]. Overtime: one entry per
   * cause, e.g. "would reach 80 h of 75 h - pay period Oct 18-31",
   * "back-to-back double after Day 07-15 Mon Oct 26".
   */
  reasons: string[];
  payPeriod: {
    /** "Oct 18-31". */
    label: string;
    hoursBefore: number;
    hoursAfter: number;
    overtimeLine: number;
  };
}

export interface AssignmentEvaluation {
  context: ScheduleContext;
  /** BLOCK first, then NEEDS_REASON, then HEADS_UP. */
  issues: ScheduleIssue[];
  /** Any BLOCK: can't be saved. */
  blocked: boolean;
  /** Any NEEDS_REASON: saving requires a recorded reason. */
  needsReason: boolean;
  payType: PayTypeClassification;
}
