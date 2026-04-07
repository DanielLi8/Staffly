import type { Prisma } from "@prisma/client";

/** Default relations for shift cards and detail views */
export const shiftCardInclude = {
  department: { select: { id: true, name: true, code: true, iconKey: true, wing: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  assignedWorker: {
    select: { id: true, name: true, email: true, department: true, position: true, image: true },
  },
  bids: {
    include: {
      worker: { select: { id: true, name: true, email: true, department: true, position: true } },
    },
  },
} satisfies Prisma.ShiftInclude;
