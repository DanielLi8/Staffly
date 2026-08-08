/**
 * Order users most-senior first.
 *
 * Ranking rules, applied in order:
 *   1. `seniorityRank` ascending when set (lower rank = more senior). A null rank
 *      is treated as least senior and sorts after every ranked user.
 *   2. `hireDate` ascending (earlier hire = more senior). A null hireDate sorts
 *      after any known hireDate.
 *   3. `id` ascending, as a stable final tiebreaker.
 *
 * The input array is not mutated.
 */
export function rankBySeniority<
  T extends { seniorityRank: number | null; hireDate: Date | null; id: string },
>(users: T[]): T[] {
  return [...users].sort((a, b) => {
    // 1. seniorityRank: lower wins; null sorts last.
    if (a.seniorityRank !== b.seniorityRank) {
      if (a.seniorityRank === null) return 1;
      if (b.seniorityRank === null) return -1;
      return a.seniorityRank - b.seniorityRank;
    }

    // 2. hireDate: earlier wins; null sorts last.
    const aTime = a.hireDate ? a.hireDate.getTime() : null;
    const bTime = b.hireDate ? b.hireDate.getTime() : null;
    if (aTime !== bTime) {
      if (aTime === null) return 1;
      if (bTime === null) return -1;
      return aTime - bTime;
    }

    // 3. id ascending, stable final tiebreaker.
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}
