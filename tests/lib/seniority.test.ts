import { describe, it, expect } from "vitest";
import { rankBySeniority } from "@/lib/seniority";

type U = { id: string; seniorityRank: number | null; hireDate: Date | null };

const ids = (users: U[]) => users.map((u) => u.id);

describe("rankBySeniority", () => {
  it("orders by seniorityRank ascending (lower rank = more senior)", () => {
    const users: U[] = [
      { id: "b", seniorityRank: 3, hireDate: null },
      { id: "a", seniorityRank: 1, hireDate: null },
      { id: "c", seniorityRank: 2, hireDate: null },
    ];
    expect(ids(rankBySeniority(users))).toEqual(["a", "c", "b"]);
  });

  it("sorts null seniorityRank after any ranked user", () => {
    const users: U[] = [
      { id: "unranked", seniorityRank: null, hireDate: null },
      { id: "ranked", seniorityRank: 5, hireDate: null },
    ];
    expect(ids(rankBySeniority(users))).toEqual(["ranked", "unranked"]);
  });

  it("breaks equal ranks by earlier hireDate", () => {
    const users: U[] = [
      { id: "later", seniorityRank: 1, hireDate: new Date("2022-01-01") },
      { id: "earlier", seniorityRank: 1, hireDate: new Date("2020-01-01") },
    ];
    expect(ids(rankBySeniority(users))).toEqual(["earlier", "later"]);
  });

  it("uses hireDate when no rank is set, null hireDate sorting last", () => {
    const users: U[] = [
      { id: "no-date", seniorityRank: null, hireDate: null },
      { id: "recent", seniorityRank: null, hireDate: new Date("2023-06-01") },
      { id: "veteran", seniorityRank: null, hireDate: new Date("2015-06-01") },
    ];
    expect(ids(rankBySeniority(users))).toEqual(["veteran", "recent", "no-date"]);
  });

  it("falls back to id ascending as a stable final tiebreaker", () => {
    const users: U[] = [
      { id: "z", seniorityRank: 2, hireDate: new Date("2020-01-01") },
      { id: "a", seniorityRank: 2, hireDate: new Date("2020-01-01") },
      { id: "m", seniorityRank: 2, hireDate: new Date("2020-01-01") },
    ];
    expect(ids(rankBySeniority(users))).toEqual(["a", "m", "z"]);
  });

  it("does not mutate the input array", () => {
    const users: U[] = [
      { id: "b", seniorityRank: 2, hireDate: null },
      { id: "a", seniorityRank: 1, hireDate: null },
    ];
    const snapshot = ids(users);
    rankBySeniority(users);
    expect(ids(users)).toEqual(snapshot);
  });

  it("applies rank, then hireDate, then id across a mixed set", () => {
    const users: U[] = [
      { id: "d", seniorityRank: null, hireDate: new Date("2018-01-01") },
      { id: "c", seniorityRank: null, hireDate: null },
      { id: "b2", seniorityRank: 1, hireDate: new Date("2019-01-01") },
      { id: "b1", seniorityRank: 1, hireDate: new Date("2019-01-01") },
      { id: "a", seniorityRank: 1, hireDate: new Date("2017-01-01") },
    ];
    expect(ids(rankBySeniority(users))).toEqual(["a", "b1", "b2", "d", "c"]);
  });
});
