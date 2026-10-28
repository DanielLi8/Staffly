import type { Role } from "@prisma/client";

/**
 * The permission matrix, as data. Every access decision in the app names a
 * capability from {@link CAPABILITIES} and asks {@link can}; no code compares
 * `role` to a literal. Pure and dependency-free (types only), so it is safe in
 * middleware, client components and unit tests alike.
 *
 * Each row carries two columns:
 *
 * - `today`: what each CURRENT role may do. This is the only column that is
 *   enforced. A role absent from it can never do the action.
 * - `target`: the captain's decided end state (data/staffly-access-control-plan
 *   decisions), per PLANNED role. Documentation only until the role PR (AC2)
 *   adds those roles and moves the target into `today`.
 *
 * A row with `status: "planned"` is an action that does not exist yet; it is
 * listed so the decided rule is visible next to the live ones, and `can()`
 * refuses it for everyone.
 *
 * `enforcedAt` names every entry point that gates on the row: server actions
 * and route handlers as `<file>#<export>` (asserted by
 * `tests/authz/entry-points.test.ts`, which fails for an action with no row),
 * plus pages, middleware and live topics for reference.
 */

/** How far a current role's capability reaches. */
export type Grant =
  /** Every department, every person. */
  | "all"
  /** Only departments the actor is a member of (`DepartmentMembership`). */
  | "memberDepartments"
  /** Only themselves. */
  | "own";

/** The roles the captain decided on (not yet in `enum Role`). */
export type PlannedRole = "WORKER" | "UAC" | "STAFFING_ADMIN" | "MANAGER" | "SYSTEM_ADMIN";

/** A decided, not-yet-enforced grant for a planned role. */
export type TargetGrant =
  /** Every department. */
  | "all"
  /** View every department, write none of them. */
  | "readAll"
  /** Their own departments (view and edit). */
  | "departments"
  /** The 2-8 units they manage, as scoped by a System Admin. */
  | "managedUnits"
  /** Only the workers in the units they manage. */
  | "managedWorkers"
  /** Only themselves. */
  | "own"
  /** Draft their own line; awards, OT, swaps and published edits on themselves need another admin or a Manager. */
  | "draftOwn"
  /** Approves, within their scope. */
  | "approves"
  /** Approves for someone else, never for themselves. */
  | "approvesOthers"
  /** May start it, but it waits for a Manager's approval. */
  | "needsApproval"
  /** Never. */
  | "none";

/** Captain decision files in data/staffly-access-control-plan/decisions/. */
export type DecisionKey =
  | "admin-department-scope"
  | "manager-approval-scope"
  | "staff-admin-authority"
  | "uac-self-scheduling";

export type CapabilityGroup =
  | "Portal"
  | "Viewing schedules and data"
  | "Worker self-service"
  | "Shifts: editorial rights"
  | "Planning and publishing"
  | "Approvals"
  | "Edit lock"
  | "Staff and access";

export interface CapabilityRow {
  group: CapabilityGroup;
  label: string;
  status: "active" | "planned";
  today: Partial<Record<Role, Grant>>;
  target: Record<PlannedRole, TargetGrant>;
  decisions?: readonly DecisionKey[];
  enforcedAt?: readonly string[];
  note?: string;
}

/* ----------------------------------------------------------- target presets */

const ADMIN_WRITE = {
  WORKER: "none",
  UAC: "departments",
  STAFFING_ADMIN: "departments",
  MANAGER: "managedUnits",
  SYSTEM_ADMIN: "all",
} as const satisfies Record<PlannedRole, TargetGrant>;

const ADMIN_READ = {
  WORKER: "none",
  UAC: "departments",
  STAFFING_ADMIN: "readAll",
  MANAGER: "managedUnits",
  SYSTEM_ADMIN: "all",
} as const satisfies Record<PlannedRole, TargetGrant>;

const ADMIN_READ_PEOPLE = { ...ADMIN_READ, MANAGER: "managedWorkers" } as const satisfies Record<
  PlannedRole,
  TargetGrant
>;

const EVERY_ADMIN = {
  WORKER: "none",
  UAC: "all",
  STAFFING_ADMIN: "all",
  MANAGER: "all",
  SYSTEM_ADMIN: "all",
} as const satisfies Record<PlannedRole, TargetGrant>;

const SELF = {
  WORKER: "own",
  UAC: "own",
  STAFFING_ADMIN: "own",
  MANAGER: "own",
  SYSTEM_ADMIN: "own",
} as const satisfies Record<PlannedRole, TargetGrant>;

const SYSTEM_ADMIN_ONLY = {
  WORKER: "none",
  UAC: "none",
  STAFFING_ADMIN: "none",
  MANAGER: "none",
  SYSTEM_ADMIN: "all",
} as const satisfies Record<PlannedRole, TargetGrant>;

const NOBODY = {
  WORKER: "none",
  UAC: "none",
  STAFFING_ADMIN: "none",
  MANAGER: "none",
  SYSTEM_ADMIN: "none",
} as const satisfies Record<PlannedRole, TargetGrant>;

const ADMINS_TODAY = { ADMIN: "all" } as const;
const STAFF_SELF_TODAY = { STAFF: "own" } as const;
const EVERYONE_SELF_TODAY = { STAFF: "own", ADMIN: "own" } as const;

const SCHEDULED_ADMINS_NOTE = "Admins only when they are a scheduled person (AC3).";

/* ------------------------------------------------------------------ matrix */

export const CAPABILITIES = {
  /* ---------------------------------------------------------------- Portal */
  "portal.admin": {
    group: "Portal",
    label: "Use the admin portal: sign in at Admin, open /admin, land on the admin home",
    status: "active",
    today: ADMINS_TODAY,
    target: EVERY_ADMIN,
    enforcedAt: ["middleware /admin/* (adminRouteRedirect)", "page /", "login portal ADMIN"],
  },
  "portal.staffSignIn": {
    group: "Portal",
    label: "Sign in at the Staff portal",
    status: "active",
    today: STAFF_SELF_TODAY,
    target: { ...NOBODY, WORKER: "own", UAC: "own" },
    decisions: ["uac-self-scheduling"],
    enforcedAt: ["login portal STAFF"],
    note: "A scheduled UAC may need the staff portal too (AC3).",
  },
  "viewMode.switch": {
    group: "Portal",
    label: "Preview the app as a worker (View as)",
    status: "active",
    today: ADMINS_TODAY,
    target: EVERY_ADMIN,
    enforcedAt: ["src/app/actions/view-mode.ts#setViewMode", "HamburgerDrawer View as"],
  },
  "admin.editOnPhone": {
    group: "Portal",
    label: "Admin editing from a phone",
    status: "planned",
    today: {},
    target: NOBODY,
    decisions: ["staff-admin-authority"],
    note: "Captain: no admin editing in the phone view; admin pages may be read-only there. The phone app (later) is strictly for staff: view schedule, swap, change availability.",
  },

  /* --------------------------------------------- Viewing schedules and data */
  "schedule.beScheduled": {
    group: "Viewing schedules and data",
    label: "Be a scheduled person: hold shifts, get callouts, appear in staff search, the directory and swap lists",
    status: "active",
    today: STAFF_SELF_TODAY,
    target: { ...NOBODY, WORKER: "own", UAC: "own" },
    decisions: ["uac-self-scheduling"],
    enforcedAt: [
      "loadTierCandidates (callout recipients)",
      "searchScheduleTargets / getDefaultScheduleTargets (staff results)",
      "page /admin/workers (listed people)",
      "page /admin/schedule?type=staff (subject)",
      "listUnitGiveawayCandidates / createShiftSwapRequest (target)",
    ],
    note: "Later: any active person with a position and a department membership, not a role (AC3).",
  },
  "locationSchedule.view": {
    group: "Viewing schedules and data",
    label: "See a department's roster (Location Schedule)",
    status: "active",
    today: { STAFF: "memberDepartments", ADMIN: "all" },
    target: { ...ADMIN_READ, WORKER: "departments" },
    decisions: ["admin-department-scope"],
    enforcedAt: ["canViewLocationSchedule", "page /worker/location", "page /admin/schedule?type=department"],
  },
  "schedule.viewAnyone": {
    group: "Viewing schedules and data",
    label: "Open any person's or department's schedule (staff search)",
    status: "active",
    today: ADMINS_TODAY,
    target: ADMIN_READ_PEOPLE,
    decisions: ["admin-department-scope"],
    enforcedAt: [
      "src/app/actions/schedule-search.ts#searchScheduleTargets",
      "src/app/actions/schedule-search.ts#getDefaultScheduleTargets",
      "page /admin/schedule",
      "notifyAdminsOfAvailabilityChange (recipients)",
    ],
    note: "Managers open only the schedules of workers under them.",
  },
  "shift.viewAll": {
    group: "Viewing schedules and data",
    label: "See every shift: lists, bidders, callout dashboard, outreach log, activity",
    status: "active",
    today: ADMINS_TODAY,
    target: ADMIN_READ,
    decisions: ["admin-department-scope"],
    enforcedAt: [
      "shiftReadScope",
      "page /admin",
      "page /admin/shifts",
      "page /admin/shifts/[id]",
      "live admin-shift, admin-shifts",
    ],
  },
  "staff.viewDirectory": {
    group: "Viewing schedules and data",
    label: "Staff directory",
    status: "active",
    today: ADMINS_TODAY,
    target: ADMIN_READ_PEOPLE,
    decisions: ["admin-department-scope"],
    enforcedAt: ["page /admin/workers"],
  },
  "department.viewPublished": {
    group: "Viewing schedules and data",
    label: "Department page, Published mode (hours, availability, ST/OT flags)",
    status: "planned",
    today: {},
    target: ADMIN_READ,
    decisions: ["admin-department-scope"],
  },
  "department.viewPlanning": {
    group: "Viewing schedules and data",
    label: "Department page, Planning mode (drafts)",
    status: "planned",
    today: {},
    target: ADMIN_WRITE,
    decisions: ["admin-department-scope"],
    note: "Only admins with rights in that department.",
  },
  "staff.viewHoursAndAvailability": {
    group: "Viewing schedules and data",
    label: "Colleagues' availability and pay-period hours",
    status: "planned",
    today: {},
    target: ADMIN_READ_PEOPLE,
    decisions: ["admin-department-scope"],
  },
  "audit.view": {
    group: "Viewing schedules and data",
    label: "Audit log: roles, accounts, overrides",
    status: "planned",
    today: {},
    target: { ...NOBODY, MANAGER: "managedUnits", SYSTEM_ADMIN: "all" },
  },

  /* --------------------------------------------------- Worker self-service */
  "shift.bid": {
    group: "Worker self-service",
    label: "Bid on or accept a shift, decline an offer, see open shifts I can bid on",
    status: "active",
    today: STAFF_SELF_TODAY,
    target: SELF,
    decisions: ["uac-self-scheduling"],
    enforcedAt: [
      "src/app/actions/bids.ts#placeBid",
      "src/app/actions/bids.ts#declineShift",
      "shiftReadScope (bidding scope)",
      "live worker-shift, worker-open-shifts",
    ],
    note: `SMS/IVR replies go through submitBid for any verified phone, whatever the role. Position must match. ${SCHEDULED_ADMINS_NOTE}`,
  },
  "bid.withdrawOwn": {
    group: "Worker self-service",
    label: "Withdraw own bid",
    status: "active",
    today: STAFF_SELF_TODAY,
    target: SELF,
    enforcedAt: ["src/app/actions/bids.ts#withdrawBid"],
    note: SCHEDULED_ADMINS_NOTE,
  },
  "bid.viewOwn": {
    group: "Worker self-service",
    label: "Own bid history, live and as CSV",
    status: "active",
    today: STAFF_SELF_TODAY,
    target: SELF,
    enforcedAt: ["src/app/api/worker/bids/export/route.ts#GET", "live worker-bids"],
    note: SCHEDULED_ADMINS_NOTE,
  },
  "availability.editOwn": {
    group: "Worker self-service",
    label: "Set own availability (save, undo, load)",
    status: "active",
    today: STAFF_SELF_TODAY,
    target: SELF,
    enforcedAt: [
      "src/app/actions/availability.ts#saveAvailability",
      "src/app/actions/availability.ts#restoreAvailability",
      "src/app/actions/availability.ts#loadAvailabilityContext",
    ],
    note: SCHEDULED_ADMINS_NOTE,
  },
  "swap.request": {
    group: "Worker self-service",
    label: "Request a swap or giveaway; accept or reject one",
    status: "active",
    today: STAFF_SELF_TODAY,
    target: SELF,
    decisions: ["manager-approval-scope"],
    enforcedAt: [
      "src/app/actions/shift-swap.ts#listMyGiveableShifts",
      "src/app/actions/shift-swap.ts#listUnitSwapCandidates",
      "src/app/actions/shift-swap.ts#listUnitGiveawayCandidates",
      "src/app/actions/shift-swap.ts#createShiftSwapRequest",
      "src/app/actions/shift-swap.ts#listIncomingShiftSwapRequests",
      "src/app/actions/shift-swap.ts#acceptShiftSwapRequest",
      "src/app/actions/shift-swap.ts#rejectShiftSwapRequest",
      "page /worker/schedule (incoming requests)",
    ],
    note: `Needs a Manager's approval to take effect. ${SCHEDULED_ADMINS_NOTE}`,
  },
  "timeOff.request": {
    group: "Worker self-service",
    label: "Request time off",
    status: "planned",
    today: {},
    target: SELF,
    decisions: ["manager-approval-scope"],
    note: "Needs a Manager's approval to take effect.",
  },
  "profile.verifyPhone": {
    group: "Worker self-service",
    label: "Verify own phone number",
    status: "active",
    today: EVERYONE_SELF_TODAY,
    target: SELF,
    enforcedAt: [
      "src/app/actions/profile.ts#startPhoneVerification",
      "src/app/actions/profile.ts#confirmPhoneVerification",
    ],
  },
  "notifications.readOwn": {
    group: "Worker self-service",
    label: "Read and mark own notifications",
    status: "active",
    today: EVERYONE_SELF_TODAY,
    target: SELF,
    enforcedAt: ["src/app/api/notifications/route.ts#GET", "src/app/api/notifications/route.ts#PATCH"],
  },
  "account.resetOwnPassword": {
    group: "Worker self-service",
    label: "Reset own password (forgot password)",
    status: "planned",
    today: {},
    target: SELF,
    decisions: ["staff-admin-authority"],
    note: "Captain: users reset their own password; email/password login stays, SSO later.",
  },

  /* ---------------------------------------------- Shifts: editorial rights */
  "shift.create": {
    group: "Shifts: editorial rights",
    label: "Post an open shift (starts a callout)",
    status: "active",
    today: ADMINS_TODAY,
    target: ADMIN_WRITE,
    decisions: ["admin-department-scope"],
    enforcedAt: ["src/app/actions/shifts.ts#createShift", "page /admin/shifts/new"],
  },
  "shift.editTime": {
    group: "Shifts: editorial rights",
    label: "Edit a shift's time",
    status: "active",
    today: ADMINS_TODAY,
    target: ADMIN_WRITE,
    decisions: ["admin-department-scope", "uac-self-scheduling"],
    enforcedAt: ["src/app/actions/shifts.ts#editShiftTime"],
  },
  "shift.cancel": {
    group: "Shifts: editorial rights",
    label: "Cancel a shift",
    status: "active",
    today: ADMINS_TODAY,
    target: ADMIN_WRITE,
    decisions: ["admin-department-scope"],
    enforcedAt: ["src/app/actions/shifts.ts#cancelShift"],
  },
  "shift.award": {
    group: "Shifts: editorial rights",
    label: "Award a shift to a bidder",
    status: "active",
    today: ADMINS_TODAY,
    target: ADMIN_WRITE,
    decisions: ["admin-department-scope", "uac-self-scheduling"],
    enforcedAt: ["src/app/actions/shifts.ts#assignWorker", "notifyAdminsOfNewBid (recipients)"],
    note: "Never to themselves: an award on an admin's own line needs another admin or a Manager.",
  },
  "callout.control": {
    group: "Shifts: editorial rights",
    label: "Callout: advance, hold, resume, stop",
    status: "active",
    today: ADMINS_TODAY,
    target: ADMIN_WRITE,
    decisions: ["admin-department-scope"],
    enforcedAt: [
      "src/app/actions/callout.ts#advanceTier",
      "src/app/actions/callout.ts#holdCallout",
      "src/app/actions/callout.ts#resumeCallout",
      "src/app/actions/callout.ts#stopCallout",
    ],
  },
  "shift.offer": {
    group: "Shifts: editorial rights",
    label: "Offer a shift to a person from the department page",
    status: "planned",
    today: {},
    target: ADMIN_WRITE,
    decisions: ["admin-department-scope"],
    note: "Captain: an offer becomes a bid; an admin then awards it.",
  },
  "shift.bookOvertime": {
    group: "Shifts: editorial rights",
    label: "Book overtime (award or offer over 75 h)",
    status: "planned",
    today: {},
    target: ADMIN_WRITE,
    decisions: ["admin-department-scope", "uac-self-scheduling"],
    note: "Captain: any staffing admin; reviewed afterwards, not approved first.",
  },
  "rule.overrideRest": {
    group: "Shifts: editorial rights",
    label: "Override the rest rule (double) with a reason",
    status: "planned",
    today: {},
    target: ADMIN_WRITE,
    note: "True overlap: never. At first posting: never.",
  },
  "rule.overrideConsecutiveDays": {
    group: "Shifts: editorial rights",
    label: "Override 7+ days in a row with a reason",
    status: "planned",
    today: {},
    target: ADMIN_WRITE,
  },
  "shift.tagTeamLead": {
    group: "Shifts: editorial rights",
    label: "Tag the Team Lead on a shift (one per shift)",
    status: "planned",
    today: {},
    target: ADMIN_WRITE,
  },
  "selfSchedule.change": {
    group: "Shifts: editorial rights",
    label: "An admin's award, OT, swap or published edit on their own schedule",
    status: "planned",
    today: {},
    target: {
      WORKER: "none",
      UAC: "needsApproval",
      STAFFING_ADMIN: "needsApproval",
      MANAGER: "needsApproval",
      SYSTEM_ADMIN: "needsApproval",
    },
    decisions: ["manager-approval-scope", "uac-self-scheduling"],
    note: "Never on yourself as an admin without someone else's approval (typed failure SELF_ACTION).",
  },

  /* ----------------------------------------------- Planning and publishing */
  "planning.draft": {
    group: "Planning and publishing",
    label: "Create a period, draft shifts (brush, fill gap, copy period)",
    status: "planned",
    today: {},
    target: ADMIN_WRITE,
    decisions: ["admin-department-scope", "uac-self-scheduling"],
    note: "A UAC may draft their own line (draftOwn) like anyone else's in their departments.",
  },
  "planning.draftOwnLine": {
    group: "Planning and publishing",
    label: "Draft their own line in the planner",
    status: "planned",
    today: {},
    target: { ...NOBODY, UAC: "draftOwn" },
    decisions: ["uac-self-scheduling"],
  },
  "planning.publish": {
    group: "Planning and publishing",
    label: "Publish a six-week schedule",
    status: "planned",
    today: {},
    target: {
      WORKER: "none",
      UAC: "needsApproval",
      STAFFING_ADMIN: "needsApproval",
      MANAGER: "approves",
      SYSTEM_ADMIN: "approves",
    },
    decisions: ["manager-approval-scope"],
    note: "Needs a Manager's sign-off. Refused while another admin holds an affected lock.",
  },
  "planning.undoRelease": {
    group: "Planning and publishing",
    label: "Undo a release",
    status: "planned",
    today: {},
    target: ADMIN_WRITE,
  },
  "staffing.editTargets": {
    group: "Planning and publishing",
    label: "Edit staffing targets and shift templates (8 h / 12 h)",
    status: "planned",
    today: {},
    target: ADMIN_WRITE,
  },
  "hospital.editRules": {
    group: "Planning and publishing",
    label: "Hospital rules: minimum rest hours, OT line, callout windows",
    status: "planned",
    today: {},
    target: SYSTEM_ADMIN_ONLY,
  },

  /* ------------------------------------------------------------- Approvals */
  "swap.approve": {
    group: "Approvals",
    label: "Approve or deny a swap or giveaway",
    status: "active",
    today: ADMINS_TODAY,
    target: { ...NOBODY, MANAGER: "approves", SYSTEM_ADMIN: "approves" },
    decisions: ["manager-approval-scope"],
    enforcedAt: [
      "src/app/actions/shift-swap-approvals.ts#listPendingShiftSwapApprovals",
      "src/app/actions/shift-swap-approvals.ts#approveShiftSwapRequest",
      "src/app/actions/shift-swap-approvals.ts#denyShiftSwapRequest",
      "page /admin/shift-swaps",
      "notifyAdminsOfShiftSwapPendingApproval (recipients)",
    ],
    note: "Captain: worker requests need a Manager's approval first; never a party to it. The queue gets an All view sorted by the soonest requested date.",
  },
  "timeOff.approve": {
    group: "Approvals",
    label: "Approve or deny time off",
    status: "planned",
    today: {},
    target: { ...NOBODY, MANAGER: "approves", SYSTEM_ADMIN: "approves" },
    decisions: ["manager-approval-scope"],
  },
  "selfSchedule.approve": {
    group: "Approvals",
    label: "Approve an admin's change to their own schedule",
    status: "planned",
    today: {},
    target: {
      WORKER: "none",
      UAC: "approvesOthers",
      STAFFING_ADMIN: "approvesOthers",
      MANAGER: "approves",
      SYSTEM_ADMIN: "approves",
    },
    decisions: ["manager-approval-scope", "uac-self-scheduling"],
    note: "uac-self-scheduling allows another admin or a Manager; manager-approval-scope names the Manager. Reconcile in AC3.",
  },
  "exceptions.acknowledge": {
    group: "Approvals",
    label: "Acknowledge exceptions (OT, doubles, 7 days)",
    status: "planned",
    today: {},
    target: { ...NOBODY, MANAGER: "approves", SYSTEM_ADMIN: "approves" },
    decisions: ["manager-approval-scope"],
    note: "Reviewed after the fact, not approved first.",
  },

  /* ------------------------------------------------------------- Edit lock */
  "lock.hold": {
    group: "Edit lock",
    label: "Hold a worker's schedule for editing",
    status: "planned",
    today: {},
    target: { ...ADMIN_WRITE, MANAGER: "managedWorkers" },
    decisions: ["admin-department-scope"],
    note: "Released only by the editor finishing or idle expiry.",
  },
  "lock.ask": {
    group: "Edit lock",
    label: "Ask the holder to finish",
    status: "planned",
    today: {},
    target: { ...ADMIN_WRITE, MANAGER: "managedWorkers" },
  },
  "lock.takeOver": {
    group: "Edit lock",
    label: "Take over another admin's lock",
    status: "planned",
    today: {},
    target: NOBODY,
    decisions: ["staff-admin-authority"],
    note: "Captain: no takeover for anyone.",
  },

  /* ------------------------------------------------------ Staff and access */
  "staff.setTeamLead": {
    group: "Staff and access",
    label: "Mark Team Lead (person tag)",
    status: "active",
    today: ADMINS_TODAY,
    target: { ...ADMIN_WRITE, MANAGER: "managedWorkers" },
    decisions: ["admin-department-scope"],
    enforcedAt: [
      "src/app/actions/workers.ts#setTeamLead",
      "src/app/(dashboard)/admin/workers/toggle-team-lead-action.ts#toggleTeamLeadFormAction",
    ],
  },
  "staff.editProfile": {
    group: "Staff and access",
    label: "Edit a person's position, seniority, phone, memberships",
    status: "planned",
    today: {},
    target: { ...ADMIN_WRITE, MANAGER: "managedWorkers" },
    decisions: ["admin-department-scope"],
  },
  "staff.add": {
    group: "Staff and access",
    label: "Add a new hire (sends set-password link)",
    status: "planned",
    today: {},
    target: SYSTEM_ADMIN_ONLY,
    decisions: ["staff-admin-authority"],
  },
  "staff.importCsv": {
    group: "Staff and access",
    label: "Import staff by CSV",
    status: "planned",
    today: {},
    target: SYSTEM_ADMIN_ONLY,
    decisions: ["staff-admin-authority"],
  },
  "staff.resendInvite": {
    group: "Staff and access",
    label: "Resend a new hire's invite",
    status: "planned",
    today: {},
    target: SYSTEM_ADMIN_ONLY,
    decisions: ["staff-admin-authority"],
    note: "Part of adding a hire. Password resets are self-service.",
  },
  "staff.deactivate": {
    group: "Staff and access",
    label: "Deactivate staff",
    status: "planned",
    today: {},
    target: SYSTEM_ADMIN_ONLY,
    decisions: ["staff-admin-authority"],
    note: "Never themselves.",
  },
  "staff.reactivate": {
    group: "Staff and access",
    label: "Reactivate staff",
    status: "planned",
    today: {},
    target: SYSTEM_ADMIN_ONLY,
    decisions: ["staff-admin-authority"],
  },
  "access.grantRoles": {
    group: "Staff and access",
    label: "Grant or revoke roles, set the departments or units an admin covers",
    status: "planned",
    today: {},
    target: SYSTEM_ADMIN_ONLY,
    decisions: ["staff-admin-authority", "admin-department-scope"],
  },
  "departments.manage": {
    group: "Staff and access",
    label: "Create or rename departments",
    status: "planned",
    today: {},
    target: SYSTEM_ADMIN_ONLY,
  },
} as const satisfies Record<string, CapabilityRow>;

export type Capability = keyof typeof CAPABILITIES;

/**
 * Rules that cut across every row. Planned: none is enforced yet.
 */
export const PLANNED_RULES = [
  {
    key: "SELF_ACTION",
    rule: "Never on yourself as an admin: award, OT, swap approval, override, deactivate and role changes refuse when the subject is the actor.",
    decisions: ["uac-self-scheduling", "manager-approval-scope"],
  },
  {
    key: "LOCKED",
    rule: "Never on a schedule another admin is editing; a lock is released only by the holder finishing or idle expiry, never taken over.",
    decisions: ["staff-admin-authority"],
  },
  {
    key: "NO_PHONE_ADMIN_EDIT",
    rule: "No admin editing on a phone; admin pages may be read-only there.",
    decisions: ["staff-admin-authority"],
  },
] as const satisfies readonly { key: string; rule: string; decisions: readonly DecisionKey[] }[];

/**
 * Entry points that answer without a capability, and what guards them
 * instead. Every server action and route handler is in exactly one of these
 * or in a row's `enforcedAt`.
 */
export const UNGATED_ENTRY_POINTS = {
  "src/app/actions/profile.ts#phoneVerificationAvailable": {
    gate: "none",
    note: "Reveals only whether Twilio Verify is configured.",
  },
  "src/app/api/live/revision/route.ts#GET": {
    gate: "session + per-topic capability",
    note: "liveTopicAccess maps each topic kind to a capability (LIVE_TOPIC_CAPABILITY).",
  },
  "src/app/api/auth/[...nextauth]/route.ts#GET": { gate: "nextauth", note: "Sign-in itself." },
  "src/app/api/auth/[...nextauth]/route.ts#POST": { gate: "nextauth", note: "Sign-in itself." },
  "src/app/api/inngest/route.ts#GET": { gate: "inngest-signing-key", note: "Callout engine steps." },
  "src/app/api/inngest/route.ts#POST": { gate: "inngest-signing-key", note: "Callout engine steps." },
  "src/app/api/inngest/route.ts#PUT": { gate: "inngest-signing-key", note: "Callout engine steps." },
  "src/app/api/webhooks/twilio/inbound-sms/route.ts#POST": {
    gate: "twilio-signature",
    note: "Sender resolved by verified phone; acceptance through submitBid.",
  },
  "src/app/api/webhooks/twilio/voice/route.ts#POST": { gate: "twilio-signature", note: "IVR prompt." },
  "src/app/api/webhooks/twilio/voice-response/route.ts#POST": {
    gate: "twilio-signature",
    note: "IVR key press; acceptance through submitBid.",
  },
  "src/app/api/webhooks/twilio/status/route.ts#POST": { gate: "twilio-signature", note: "Delivery status." },
} as const satisfies Record<string, { gate: string; note: string }>;

/* ------------------------------------------------------------- evaluation */

/** Who is asking. An {@link Actor} fits; `id` is only needed for `own` checks. */
export interface CapabilityHolder {
  role: Role;
  id?: string;
}

/**
 * What a check is about. Leave it out to ask "does the actor hold this
 * capability at all" (the entry-point gate); pass it to ask about one
 * department or person, which every scoped grant then requires.
 */
export interface CapabilityScope {
  /** The department the action touches (a shift's or roster's department). */
  departmentId?: string;
  /** The actor's own department memberships, resolved by the caller. */
  actorDepartmentIds?: readonly string[];
  /** The person the action is about. */
  subjectUserId?: string;
}

/** Thrown by {@link requireCapability} when an actor lacks a capability. */
export class AuthorizationError extends Error {
  constructor(message = "FORBIDDEN") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** The grant `holder` has for `capability` today, or null. Planned rows grant nothing. */
export function grantFor(holder: CapabilityHolder | null | undefined, capability: Capability): Grant | null {
  if (!holder) return null;
  const row: CapabilityRow = CAPABILITIES[capability];
  if (!row || row.status !== "active") return null;
  return row.today[holder.role] ?? null;
}

/**
 * Whether `holder` may do `capability` (in `scope`, when given). Fails closed:
 * no holder, an unknown role or capability, a planned row, or a scoped check
 * missing what its grant needs all answer false.
 */
export function can(
  holder: CapabilityHolder | null | undefined,
  capability: Capability,
  scope?: CapabilityScope
): boolean {
  const grant = grantFor(holder, capability);
  if (!grant || !holder) return false;
  if (!scope) return true;

  switch (grant) {
    case "all":
      return true;
    case "own":
      return scope.subjectUserId === undefined || (holder.id !== undefined && scope.subjectUserId === holder.id);
    case "memberDepartments":
      return scope.departmentId !== undefined && (scope.actorDepartmentIds ?? []).includes(scope.departmentId);
    default:
      return false;
  }
}

/** Assert {@link can}; throws {@link AuthorizationError} otherwise. Returns the holder. */
export function requireCapability<T extends CapabilityHolder>(
  holder: T,
  capability: Capability,
  scope?: CapabilityScope
): T {
  if (!can(holder, capability, scope)) throw new AuthorizationError("FORBIDDEN");
  return holder;
}

/**
 * The roles that hold `capability` today. For queries that pick people by
 * what they may do (who gets a callout, which admins hear about a bid).
 */
export function rolesWith(capability: Capability): Role[] {
  const row: CapabilityRow = CAPABILITIES[capability];
  if (row.status !== "active") return [];
  return (Object.keys(row.today) as Role[]).filter((role) => row.today[role] !== undefined);
}

/** A Prisma `User` filter for people whose role holds `capability`. */
export function roleWhere(capability: Capability): { role: { in: Role[] } } {
  return { role: { in: rolesWith(capability) } };
}

/* ------------------------------------------------------------ login portals */

/** The Staff | Admin picker on the login page; each needs its capability. */
export const LOGIN_PORTALS = {
  STAFF: { label: "Staff", capability: "portal.staffSignIn" },
  ADMIN: { label: "Admin", capability: "portal.admin" },
} as const satisfies Record<string, { label: string; capability: Capability }>;

export type LoginPortal = keyof typeof LOGIN_PORTALS;

/** Whether a user of `role` may sign in through `portal`. Unknown portals refuse. */
export function canUseLoginPortal(role: Role, portal: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(LOGIN_PORTALS, portal)) return false;
  return can({ role }, LOGIN_PORTALS[portal as LoginPortal].capability);
}

/* ---------------------------------------------------------- role display */

/** How a role is named in the UI. Display only - never an access decision. */
export const ROLE_DISPLAY: Record<Role, { label: string; badge: string | null }> = {
  STAFF: { label: "Staff member", badge: null },
  ADMIN: { label: "Admin", badge: "Admin" },
};
