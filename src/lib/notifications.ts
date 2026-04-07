import { db } from "./db";
import { sendEmail, newShiftEmailHtml, assignmentEmailHtml } from "./email";
import { format } from "date-fns";
import type { Shift, User } from "@prisma/client";

const APP_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

export async function notifyWorkersOfNewShift(
  shift: Shift,
  workers: Pick<User, "id" | "name" | "email">[]
): Promise<void> {
  const shiftDate = format(new Date(shift.startsAt), "EEE, MMM d · h:mm a");

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
}): Promise<void> {
  await db.notification.create({
    data: {
      userId: opts.adminId,
      type: "BID_SUBMITTED",
      title: "New Bid Received",
      message: `${opts.workerName} bid on ${opts.shift.title}.`,
      shiftId: opts.shift.id,
    },
  });
}

export async function notifyWorkersOfAssignment(opts: {
  shift: Shift;
  selectedWorkerId: string;
  allBidderIds: string[];
}): Promise<void> {
  const { shift, selectedWorkerId, allBidderIds } = opts;
  const shiftDate = format(new Date(shift.startsAt), "EEE, MMM d · h:mm a");

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
