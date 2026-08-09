import { describe, it, expect } from "vitest";
import { parseReply, generateShiftCode } from "@/lib/outreach/codes";

describe("parseReply - full-shift accepts", () => {
  it("treats a bare code as a full-shift accept", () => {
    expect(parseReply("ER4B")).toEqual({ kind: "bid", scope: "FULL", code: "ER4B" });
  });

  it("accepts YES <code>", () => {
    expect(parseReply("YES ER4B")).toEqual({ kind: "bid", scope: "FULL", code: "ER4B" });
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    expect(parseReply("  yes   er4b  ")).toEqual({ kind: "bid", scope: "FULL", code: "ER4B" });
  });

  it("accepts ACCEPT / Y / OK / CONFIRM as full-accept keywords", () => {
    for (const kw of ["ACCEPT", "Y", "OK", "CONFIRM"]) {
      expect(parseReply(`${kw} MD5C`)).toEqual({ kind: "bid", scope: "FULL", code: "MD5C" });
    }
  });
});

describe("parseReply - partial-window accepts", () => {
  it("parses PART <code> as a partial bid", () => {
    expect(parseReply("PART ER4B")).toEqual({ kind: "bid", scope: "PARTIAL", code: "ER4B" });
  });

  it("accepts PARTIAL / P / SOME as partial keywords", () => {
    for (const kw of ["PARTIAL", "P", "SOME"]) {
      expect(parseReply(`${kw} MD5C`)).toEqual({ kind: "bid", scope: "PARTIAL", code: "MD5C" });
    }
  });
});

describe("parseReply - carrier control keywords", () => {
  it("recognises STOP/START/HELP and never reads them as a code", () => {
    for (const kw of ["STOP", "stop", "START", "HELP", "UNSUBSCRIBE", "CANCEL", "QUIT"]) {
      expect(parseReply(kw)).toEqual({ kind: "control", keyword: kw.toUpperCase() });
    }
  });

  it("treats a control keyword before a code as control, not a bid", () => {
    expect(parseReply("STOP ER4B")).toEqual({ kind: "control", keyword: "STOP" });
  });
});

describe("parseReply - unknown / malformed", () => {
  it("returns unknown for empty or nullish input", () => {
    expect(parseReply("")).toEqual({ kind: "unknown" });
    expect(parseReply(null)).toEqual({ kind: "unknown" });
    expect(parseReply(undefined)).toEqual({ kind: "unknown" });
    expect(parseReply("   ")).toEqual({ kind: "unknown" });
  });

  it("returns unknown for a keyword with no code", () => {
    expect(parseReply("PART")).toEqual({ kind: "unknown" });
  });

  it("returns unknown for an unrecognised keyword + code", () => {
    expect(parseReply("MAYBE ER4B")).toEqual({ kind: "unknown" });
  });

  it("returns unknown for a too-short or overly long bare token", () => {
    expect(parseReply("AB")).toEqual({ kind: "unknown" });
    expect(parseReply("ABCDEFGHIJK")).toEqual({ kind: "unknown" });
  });

  it("returns unknown for free-text with more than two tokens", () => {
    expect(parseReply("yes please ER4B")).toEqual({ kind: "unknown" });
  });
});

describe("generateShiftCode", () => {
  it("produces codes of the requested length from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateShiftCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  it("a generated code round-trips through parseReply as a full accept", () => {
    const code = generateShiftCode();
    expect(parseReply(code)).toEqual({ kind: "bid", scope: "FULL", code });
  });
});
