import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Thrown inside {@link guardedTransaction} to roll the whole transaction back
 * and hand `result` (a typed failure) to the caller instead of an exception.
 * It is how a conditional write that matched 0 rows - another admin got there
 * first - aborts the writes made before it in the same transaction.
 */
export class Rollback<R> extends Error {
  constructor(readonly result: R) {
    super("Rollback");
  }
}

/**
 * `db.$transaction(fn)`, except that a {@link Rollback} thrown by `fn` resolves
 * to its result rather than rejecting. Any other error still rejects.
 */
export async function guardedTransaction<T, R>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; result: R }> {
  try {
    return { ok: true, value: await db.$transaction(fn) };
  } catch (err) {
    if (err instanceof Rollback) return { ok: false, result: err.result as R };
    throw err;
  }
}
