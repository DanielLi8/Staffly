import { describe, it, expect } from "vitest";
import {
  TEMPLATE_PRESETS,
  activeTemplates,
  endsNextDay,
  formatDurationHours,
  formatTemplateRange,
  templateDurationMinutes,
  validateTemplateTimes,
} from "@/lib/staffing/templates";
import { describeDays, describeStaffingAudit } from "@/lib/staffing/audit";

describe("template presets (captain decision shift-hours-default)", () => {
  it("default to 8 h Day 07-15 / Evening 15-23 / Night 23-07", () => {
    const eight = activeTemplates(
      TEMPLATE_PRESETS.map((p) => ({ ...p, id: p.code })),
      "EIGHT_HOUR"
    );
    expect(eight.map((t) => `${t.label} ${formatTemplateRange(t)}`)).toEqual([
      "Day 07:00-15:00",
      "Evening 15:00-23:00",
      "Night 23:00-07:00",
    ]);
    expect(eight.every((t) => templateDurationMinutes(t.startMinute, t.endMinute) === 480)).toBe(true);
  });

  it("offer a 12 h Day 07-19 / Night 19-07 set", () => {
    const twelve = activeTemplates(
      TEMPLATE_PRESETS.map((p) => ({ ...p, id: p.code })),
      "TWELVE_HOUR"
    );
    expect(twelve.map((t) => formatTemplateRange(t))).toEqual(["07:00-19:00", "19:00-07:00"]);
    expect(twelve.every((t) => templateDurationMinutes(t.startMinute, t.endMinute) === 720)).toBe(true);
  });
});

describe("template times", () => {
  it("treats an end at or before the start as the next morning", () => {
    expect(endsNextDay(23 * 60, 7 * 60)).toBe(true);
    expect(endsNextDay(7 * 60, 15 * 60)).toBe(false);
    expect(templateDurationMinutes(19 * 60 + 30, 7 * 60)).toBe(690);
    expect(formatDurationHours(690)).toBe("11.5 h");
  });

  it("requires quarter-hour times and a non-zero length", () => {
    expect(validateTemplateTimes(420, 900)).toBeNull();
    expect(validateTemplateTimes(425, 900)).toBe("OFF_GRID");
    expect(validateTemplateTimes(420, 1440)).toBe("OFF_GRID");
    expect(validateTemplateTimes(420, 420)).toBe("ZERO_LENGTH");
  });
});

describe("change history lines", () => {
  const day = { templateId: "t", templateCode: "D", templateLabel: "Day", templatePattern: "EIGHT_HOUR" as const };

  it("names the day group a weekly change covered", () => {
    expect(describeDays(["MON", "TUE", "WED", "THU", "FRI"])).toBe("Weekdays");
    expect(describeDays(["SUN", "SAT"])).toBe("Weekends");
    expect(describeDays(["WED", "MON"])).toBe("Mon, Wed");
  });

  it("describes each kind of change", () => {
    expect(
      describeStaffingAudit({
        action: "STAFFING_TARGET_CHANGED",
        metadata: { ...day, role: "RN", days: ["SAT", "SUN"], before: [4, 4], after: 5 },
      })
    ).toBe("Day RN, Weekends: 4 → 5");
    expect(
      describeStaffingAudit({
        action: "STAFFING_TARGET_CHANGED",
        metadata: { ...day, role: "PSW", days: ["MON", "TUE"], before: [2, 3], after: 3 },
      })
    ).toBe("Day PSW, Mon, Tue: varied → 3");
    expect(
      describeStaffingAudit({
        action: "STAFFING_OVERRIDE_SET",
        metadata: { ...day, role: "RN", date: "2026-10-31", before: null, after: 6, usual: 4, reason: "Census 31 of 30" },
      })
    ).toBe("Day RN on Sat, Oct 31: 4 → 6, usually 4 (Census 31 of 30)");
    expect(
      describeStaffingAudit({
        action: "STAFFING_OVERRIDE_REMOVED",
        metadata: { ...day, role: "RN", date: "2026-10-31", before: 6, usual: 4, reason: null },
      })
    ).toBe("Day RN on Sat, Oct 31: back to the usual 4 (was 6)");
    expect(
      describeStaffingAudit({
        action: "SHIFT_TEMPLATE_CHANGED",
        metadata: {
          ...day,
          templatePattern: "TWELVE_HOUR",
          before: { startMinute: 420, endMinute: 1140, leadRequired: true },
          after: { startMinute: 450, endMinute: 1170, leadRequired: false },
        },
      })
    ).toBe("Day (12 h) shift: 07:00-19:00 → 07:30-19:30, Team Lead no longer required");
    expect(
      describeStaffingAudit({ action: "SHIFT_PATTERN_CHANGED", metadata: { before: "EIGHT_HOUR", after: "TWELVE_HOUR" } })
    ).toBe("Switched from 8-hour shifts to 12-hour shifts");
  });
});
