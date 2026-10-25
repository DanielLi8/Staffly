import { describe, it, expect } from "vitest";
import { formatShiftWhen, smsBody, smsReplies, voicePrompt } from "@/lib/outreach/messages";
import { isGsm7, smsEncoding, toGsm7, truncateGsm7 } from "@/lib/outreach/gsm7";
import type { OutreachShift } from "@/lib/outreach/types";

/**
 * Every callout text must be GSM-7 and one 160-septet segment: one en dash
 * (U+2013) used to force UCS-2 and bill a ~155-character callout as 3 segments.
 */

// 2026-11-02 12:00Z = 07:00 Toronto. A fixed date is fine here: nothing is
// validated against the clock, only formatted.
const shift = (patch: Partial<OutreachShift> = {}): OutreachShift => ({
  id: "shift-1",
  title: "Emergency (ER) – Registered Nurse",
  unit: "4B",
  roleNeeded: "Registered Nurse (RN)",
  departmentName: "Emergency",
  startsAt: new Date("2026-11-02T12:00:00Z"),
  endsAt: new Date("2026-11-03T00:00:00Z"),
  smsCode: "7K2M",
  ...patch,
});

const expectOneGsmSegment = (body: string) => {
  expect(isGsm7(body)).toBe(true);
  expect(smsEncoding(body)).toMatchObject({ encoding: "GSM-7", segments: 1 });
  expect(smsEncoding(body).units).toBeLessThanOrEqual(160);
};

describe("formatShiftWhen", () => {
  it("joins the times with a plain hyphen, never an en dash", () => {
    expect(formatShiftWhen(shift())).toBe("Mon, Nov 2, 7:00 AM-7:00 PM");
  });

  it("takes a spoken separator for voice", () => {
    expect(formatShiftWhen(shift(), " to ")).toBe("Mon, Nov 2, 7:00 AM to 7:00 PM");
  });
});

describe("smsBody - one GSM-7 segment", () => {
  it("keeps a typical callout whole, with accept, decline and partial instructions", () => {
    const body = smsBody(shift());
    expect(body).toBe(
      "Staffly: Emergency needs Registered Nurse (RN), Unit 4B, Mon, Nov 2, 7:00 AM-7:00 PM. " +
        "Reply YES 7K2M to accept, NO 7K2M to decline, PART 7K2M for partial."
    );
    expectOneGsmSegment(body);
  });

  it("fits a realistic long department name by abbreviating the role, then truncating the department", () => {
    const body = smsBody(
      shift({
        departmentName: "Cardiovascular Intensive Care Unit – Cardiac Surgery Recovery",
        startsAt: new Date("2026-11-25T15:00:00Z"), // Wed, Nov 25, 10:00 AM
        endsAt: new Date("2026-11-26T03:00:00Z"), // 10:00 PM
      })
    );
    expectOneGsmSegment(body);
    expect(body).toMatch(/^Staffly: Cardiovascular Intensive.*\.\.\. needs RN, Unit 4B, Wed, Nov 25, 10:00 AM-10:00 PM\./);
    // The reply instructions are never what gets cut.
    expect(body).toMatch(/Reply YES 7K2M to accept, NO 7K2M to decline, PART 7K2M for partial\.$/);
  });

  it("stays one segment with every free-text field long, non-GSM, and an 8-char code", () => {
    const body = smsBody(
      shift({
        departmentName: "Département de pédiatrie – soins intensifs néonatals “NICU”",
        roleNeeded: "Infirmière praticienne spécialisée en soins de première ligne",
        unit: "Tour Ouest – 12e étage – aile B",
        smsCode: "ABCDEFGH",
        startsAt: new Date("2026-11-25T15:00:00Z"),
        endsAt: new Date("2026-11-26T03:00:00Z"),
      })
    );
    expectOneGsmSegment(body);
    expect(body).toContain("NO ABCDEFGH to decline");
  });

  it("points to the app when the shift has no reply code", () => {
    const body = smsBody(shift({ smsCode: null }));
    expect(body).toMatch(/Open the Staffly app to respond\.$/);
    expectOneGsmSegment(body);
  });
});

describe("smsReplies - every confirmation is one GSM-7 segment", () => {
  const longTitle = "Cardiovascular Intensive Care Unit – Registered Nurse – “Night” float coverage";

  it.each([
    ["unknown", smsReplies.unknown],
    ["unknownSender", smsReplies.unknownSender],
    ["unknownCode", smsReplies.unknownCode("ZZZZZZZZ")],
    ["closed", smsReplies.closed],
    ["bidAccepted", smsReplies.bidAccepted(longTitle, false)],
    ["bidAccepted (partial)", smsReplies.bidAccepted(longTitle, true)],
    ["declined", smsReplies.declined(longTitle)],
    ["declineNeedsCode", smsReplies.declineNeedsCode],
    ["declineNothingOpen", smsReplies.declineNothingOpen],
  ])("%s", (_name, body) => {
    expectOneGsmSegment(body);
  });

  it("confirms a decline naming the shift", () => {
    expect(smsReplies.declined("Emergency (ER) – Registered Nurse")).toBe(
      "Got it - you declined Emergency (ER) - Registered Nurse. We won't contact you again about it."
    );
  });
});

describe("voicePrompt", () => {
  it("reads the time range as words", () => {
    expect(voicePrompt(shift())).toContain("on Mon, Nov 2, 7:00 AM to 7:00 PM.");
  });
});

describe("gsm7 helpers", () => {
  it("counts the en dash case as UCS-2, 3 segments (the original bug)", () => {
    const old =
      "Staffly: Emergency needs a Registered Nurse (RN) (Unit 4B) on Mon, Nov 2, 7:00 AM–7:00 PM. Reply YES 7K2M to accept, or PART 7K2M to offer a partial shift.";
    expect(smsEncoding(old)).toEqual({ encoding: "UCS-2", units: 155, segments: 3 });
    expect(smsEncoding(toGsm7(old))).toEqual({ encoding: "GSM-7", units: 155, segments: 1 });
  });

  it("maps typographic characters and strips accents outside the alphabet", () => {
    expect(toGsm7("7:00 AM–“Nuit” l’hôpital…")).toBe('7:00 AM-"Nuit" l\'hopital...');
    // é, ü, Ñ are already GSM-7 and survive untouched.
    expect(toGsm7("Pédiatrie Müller Ñ")).toBe("Pédiatrie Müller Ñ");
    expect(toGsm7("病院")).toBe("??");
  });

  it("counts extension characters as two septets", () => {
    expect(smsEncoding("€".repeat(80))).toMatchObject({ encoding: "GSM-7", units: 160, segments: 1 });
    expect(smsEncoding("€".repeat(81))).toMatchObject({ encoding: "GSM-7", units: 162, segments: 2 });
  });

  it("truncates with a clean ellipsis", () => {
    expect(truncateGsm7("Cardiac Intensive Care", 12)).toBe("Cardiac I...");
    // A cut right after a word drops the dangling space.
    expect(truncateGsm7("Cardiac Intensive Care", 11)).toBe("Cardiac...");
    expect(truncateGsm7("Short", 12)).toBe("Short");
  });
});
