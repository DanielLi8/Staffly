/**
 * In-memory stand-in for the `throttleEvent` table, shaped like the Prisma
 * calls `src/lib/throttle/store.ts` makes. Lives OUTSIDE any module the tests
 * reload, so it plays the shared database surviving a server cold start.
 */
type Row = { bucket: string; createdAt: Date };
type Where = { bucket?: string | { in: string[] }; createdAt?: { gt?: Date; lt?: Date } };

export function createThrottleDb() {
  let rows: Row[] = [];
  const matches = (r: Row, where: Where) => {
    if (typeof where.bucket === "string" && r.bucket !== where.bucket) return false;
    if (where.bucket && typeof where.bucket === "object" && !where.bucket.in.includes(r.bucket)) return false;
    if (where.createdAt?.gt && !(r.createdAt > where.createdAt.gt)) return false;
    if (where.createdAt?.lt && !(r.createdAt < where.createdAt.lt)) return false;
    return true;
  };
  const throttleEvent = {
    count: async ({ where }: { where: Where }) => rows.filter((r) => matches(r, where)).length,
    createMany: async ({ data }: { data: { bucket: string; createdAt?: Date }[] }) => {
      rows.push(...data.map((d) => ({ bucket: d.bucket, createdAt: d.createdAt ?? new Date() })));
      return { count: data.length };
    },
    deleteMany: async ({ where }: { where: Where }) => {
      const before = rows.length;
      rows = rows.filter((r) => !matches(r, where));
      return { count: before - rows.length };
    },
  };
  return {
    throttleEvent,
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    rows: () => rows,
    reset: () => {
      rows = [];
    },
  };
}
