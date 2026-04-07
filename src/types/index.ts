import type {
  User,
  Shift,
  ShiftBid,
  Notification,
  ShiftActivity,
  Department,
  Role,
  ShiftStatus,
  BidStatus,
  NotificationType,
} from "@prisma/client";

export type { Role, ShiftStatus, BidStatus, NotificationType };

export type SafeUser = Omit<User, "password" | "accounts" | "sessions">;

export type DepartmentSummary = Pick<Department, "id" | "name" | "code" | "iconKey" | "wing">;

export type ShiftWithRelations = Shift & {
  department: DepartmentSummary;
  createdBy: Pick<User, "id" | "name" | "email">;
  assignedWorker?: Pick<User, "id" | "name" | "email" | "image" | "department" | "position"> | null;
  bids: (ShiftBid & {
    worker: Pick<User, "id" | "name" | "email" | "department" | "position">;
  })[];
  _count?: { bids: number };
};

export type BidWithWorker = ShiftBid & {
  worker: Pick<User, "id" | "name" | "email" | "department" | "position">;
};

export type NotificationWithShift = Notification & {
  shift?: Pick<Shift, "id" | "title"> | null;
};

export type ActivityWithActor = ShiftActivity & {
  actor: Pick<User, "id" | "name">;
};

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };
