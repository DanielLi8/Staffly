import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * A verified phone number belongs to exactly one person: it is how an inbound
 * SMS reply finds its sender, so a shared one could record a bid as the wrong
 * person's. Postgres enforces it with the partial unique index
 * "User_verified_phone_key" (phone WHERE phoneVerifiedAt IS NOT NULL); these
 * helpers turn it into a friendly message before (and if a race slips past,
 * after) the write. Every path that sets `phoneVerifiedAt` should use them.
 */

export const PHONE_TAKEN_MESSAGE = "Another person already has this verified number";

const VERIFIED_PHONE_INDEX = "User_verified_phone_key";

/** Whether someone other than `selfId` already has `phone` verified. */
export async function isVerifiedPhoneTaken(phone: string, selfId: string | null): Promise<boolean> {
  const taken = await db.user.findFirst({
    where: { phone, phoneVerifiedAt: { not: null }, ...(selfId ? { id: { not: selfId } } : {}) },
    select: { id: true },
  });
  return taken !== null;
}

/** A write that lost the race against another verification of the same number. */
export function isVerifiedPhoneConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
  return fields.some((f) => f === "phone" || f.includes(VERIFIED_PHONE_INDEX));
}
