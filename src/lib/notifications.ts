import { db } from "./db";
import { sendEmail, newShiftEmailHtml, assignmentEmailHtml, shiftCancelledEmailHtml } from "./email";
import { hospitalDateTime } from "@/lib/timezone";
import type { Shift, User } from "@prisma/client";

const APP_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

export async function notifyWorkersOfNewShift(
  shift: Shift,
  workers: Pick<User, "id" | "name" | "email">[]
): Promise<void> {
  const shiftDate = hospitalDateTime(shift.startsAt);

  await Promise.allSettled(
    workers.map(async (worker) => {
      await db.notification.create({
        data: {
          userId: worker.id,
          type: "NEW_SHIFT",
          title: "New Shift Available",
          message: `A new callout shift (${shift.title}) is available on ${shiftDate}.`,
          shiftId: shift.id,
        },
      });

      await sendEmail({
        to: worker.email,
        subject: `New Shift Available – ${shift.title}`,
        html: newShiftEmailHtml({
          workerName: worker.name,
          shiftTitle: shift.title,
          unit: shift.unit,
          date: shiftDate,
          appUrl: APP_URL,
        }),
      });
    })
  );
}

export async function notifyAdminOfNewBid(opts: {
  adminId: string;
  workerName: string;
  shift: Pick<Shift, "id" | "title">;
  /** Optional channel hint, e.g. "by text" / "by phone", for outreach replies. */
  via?: string | null;
}): Promise<void> {
  const suffix = opts.via ? ` ${opts.via}` : "";
  await db.notification.create({
    data: {
      userId: opts.adminId,
      type: "BID_SUBMITTED",
      title: "New Bid Received",
      message: `${opts.workerName} bid on ${opts.shift.title}${suffix}.`,
      shiftId: opts.shift.id,
    },
  });
}

/**
 * In-app nudge to the scheduler who owns a callout: the cascade widened, ran out
 * of tiers, or the shift start passed unfilled. Reminders, never auto-actions -
 * the scheduler stays in control of the callout.
 */
export async function notifySchedulerOfCallout(opts: {
  schedulerId: string;
  type: "CALLOUT_ESCALATED" | "CALLOUT_REMINDER";
  title: string;
  message: string;
  shiftId: string;
}): Promise<void> {
  await db.notification.create({
    data: {
      userId: opts.schedulerId,
      type: opts.type,
      title: opts.title,
      message: opts.message,
      shiftId: opts.shiftId,
    },
  });
}

export async function notifyWorkerOfCancellation(opts: {
  shift: Shift;
  workerId: string;
}): Promise<void> {
  const { shift, workerId } = opts;
  const shiftDate = hospitalDateTime(shift.startsAt);

  const worker = await db.user.findUnique({
    where: { id: workerId },
    select: { id: true, name: true, email: true },
  });
  if (!worker) return;

  await db.notification.create({
    data: {
      userId: worker.id,
      type: "SHIFT_CANCELLED",
      title: "Shift Cancelled",
      message: `Your shift (${shift.title}) on ${shiftDate} was cancelled.`,
      shiftId: shift.id,
    },
  });

  await sendEmail({
    to: worker.email,
    subject: `Shift Cancelled – ${shift.title}`,
    html: shiftCancelledEmailHtml({
      workerName: worker.name,
      shiftTitle: shift.title,
      date: shiftDate,
      appUrl: APP_URL,
    }),
  });
}

/**
 * A confirmation receipt to the worker themselves after they save an
 * availability change (see `saveAvailability` in `src/app/actions/availability.ts`).
 */
export async function notifyWorkerOfAvailabilityUpdate(opts: {
  workerId: string;
  dateLabel: string;
}): Promise<void> {
  await db.notification.create({
    data: {
      userId: opts.workerId,
      type: "AVAILABILITY_UPDATED",
      title: "Availability Updated",
      message: `Your availability for ${opts.dateLabel} was updated.`,
    },
  });
}

/**
 * Broadcasts to every ADMIN, not a single owner: unlike a bid or a
 * cancellation, an availability change has no shift/campaign it belongs to,
 * yet it can affect any admin's already-running callout or future staffing.
 * There is no existing "notify every admin" helper elsewhere in this file to
 * reuse - this is the first one.
 */
export async function notifyAdminsOfAvailabilityChange(opts: {
  workerName: string;
  dateLabel: string;
}): Promise<void> {
  const admins = await db.user.findMany({
    where: { role: "ADMIN" },
    select: { id: true },
  });

  await Promise.allSettled(
    admins.map((admin) =>
      db.notification.create({
        data: {
          userId: admin.id,
          type: "AVAILABILITY_UPDATED",
          title: "Worker Availability Changed",
          message: `${opts.workerName}'s availability for ${opts.dateLabel} changed.`,
        },
      })
    )
  );
}

export async function notifyWorkersOfAssignment(opts: {
  shift: Shift;
  selectedWorkerId: string;
  allBidderIds: string[];
}): Promise<void> {
  const { shift, selectedWorkerId, allBidderIds } = opts;
  const shiftDate = hospitalDateTime(shift.startsAt);

  const workers = await db.user.findMany({
    where: { id: { in: allBidderIds } },
    select: { id: true, name: true, email: true },
  });

  await Promise.allSettled(
    workers.map(async (worker) => {
      const selected = worker.id === selectedWorkerId;

      await db.notification.create({
        data: {
          userId: worker.id,
          type: selected ? "BID_SELECTED" : "BID_NOT_SELECTED",
          title: selected ? "You've Been Assigned!" : "Shift Filled",
          message: selected
            ? `You were selected for ${shift.title} on ${shiftDate}.`
            : `Another worker was selected for ${shift.title}.`,
          shiftId: shift.id,
        },
      });

      await sendEmail({
        to: worker.email,
        subject: selected
          ? `You've Been Assigned – ${shift.title}`
          : `Shift Filled – ${shift.title}`,
        html: assignmentEmailHtml({
          workerName: worker.name,
          shiftTitle: shift.title,
          date: shiftDate,
          selected,
          appUrl: APP_URL,
        }),
      });
    })
  );
}
