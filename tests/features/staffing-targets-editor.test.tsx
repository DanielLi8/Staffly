import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { DayOfWeek } from "@prisma/client";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const actions = vi.hoisted(() => ({
  saveWeeklyTargets: vi.fn(),
  setTargetOverride: vi.fn(),
  removeTargetOverride: vi.fn(),
  applySundayNumbers: vi.fn(),
  updateShiftTemplate: vi.fn(),
  setShiftPattern: vi.fn(),
}));
vi.mock("@/app/actions/staffing-targets", () => actions);

import { StaffingTargetsEditor } from "@/features/staffing-targets/staffing-targets-editor";
import type { StaffingTargetsView } from "@/lib/staffing/store";

const WEEKDAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI"];
const ALL: DayOfWeek[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function view(overrides: Partial<StaffingTargetsView> = {}): StaffingTargetsView {
  return {
    department: {
      id: "dept-med",
      name: "Medical/Surgical",
      code: "MED",
      iconKey: "cross",
      unitLabel: "5C",
      location: null,
      shiftPattern: "EIGHT_HOUR",
    },
    templates: [
      { id: "d", pattern: "EIGHT_HOUR", code: "D", label: "Day", startMinute: 420, endMinute: 900, leadRequired: true, sortOrder: 0 },
      { id: "e", pattern: "EIGHT_HOUR", code: "E", label: "Evening", startMinute: 900, endMinute: 1380, leadRequired: true, sortOrder: 1 },
      { id: "n", pattern: "EIGHT_HOUR", code: "N", label: "Night", startMinute: 1380, endMinute: 420, leadRequired: true, sortOrder: 2 },
      { id: "d12", pattern: "TWELVE_HOUR", code: "D12", label: "Day", startMinute: 420, endMinute: 1140, leadRequired: true, sortOrder: 0 },
      { id: "n12", pattern: "TWELVE_HOUR", code: "N12", label: "Night", startMinute: 1140, endMinute: 420, leadRequired: true, sortOrder: 1 },
    ],
    weekly: [
      // Day RN: 5 weekdays, 4 weekends.
      ...ALL.map((dayOfWeek) => ({ templateId: "d", dayOfWeek, role: "RN" as const, count: WEEKDAYS.includes(dayOfWeek) ? 5 : 4 })),
      // Day PSW differs across the weekdays (Mon 3, the rest 2).
      ...WEEKDAYS.map((dayOfWeek) => ({ templateId: "d", dayOfWeek, role: "PSW" as const, count: dayOfWeek === "MON" ? 3 : 2 })),
    ],
    overrides: [
      {
        id: "o1",
        templateId: "d",
        date: "2030-01-05",
        role: "RN",
        count: 6,
        reason: "Census 31 of 30",
        setByName: "Sarah Chen",
        updatedAt: "2030-01-01T12:00:00.000Z",
      },
    ],
    history: [{ id: "h1", at: "2030-01-01T12:00:00.000Z", actorName: "Sarah Chen", line: "Day RN, Weekdays: 4 → 5" }],
    today: "2030-01-01",
    ...overrides,
  };
}

const weeklyCard = () => screen.getByRole("region", { name: "Projected staffing" });

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(actions)) fn.mockResolvedValue({ ok: true, message: "Saved 1 change." });
});

describe("StaffingTargetsEditor - weekly numbers", () => {
  it("shows weekday and weekend numbers per shift and role, and '–' where the days differ", () => {
    render(<StaffingTargetsEditor view={view()} />);
    expect(screen.getByRole("textbox", { name: "Day RN, weekdays" })).toHaveValue("5");
    expect(screen.getByRole("textbox", { name: "Day RN, weekends" })).toHaveValue("4");
    const varies = screen.getByRole("textbox", { name: /^Day PSW, weekdays \(varies: Mon 3, Tue 2/ });
    expect(varies).toHaveValue("");
    expect(varies).toHaveAttribute("placeholder", "–");
    // Only the department's 8-hour shifts carry targets.
    expect(within(weeklyCard()).getByText("Evening")).toBeInTheDocument();
    expect(within(weeklyCard()).queryByText(/07:00-19:00/)).not.toBeInTheDocument();
  });

  it("saves a weekday edit as one change covering Mon-Fri, with the numbers the admin saw", async () => {
    render(<StaffingTargetsEditor view={view()} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase Day RN, weekdays" }));
    expect(screen.getByRole("textbox", { name: "Day RN, weekdays" })).toHaveValue("6");
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(actions.saveWeeklyTargets).toHaveBeenCalledTimes(1));
    expect(actions.saveWeeklyTargets).toHaveBeenCalledWith({
      departmentId: "dept-med",
      changes: [{ templateId: "d", role: "RN", count: 6, days: WEEKDAYS, before: [5, 5, 5, 5, 5] }],
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved 1 change.");
    expect(refresh).toHaveBeenCalled();
  });

  it("sets every day of a varying group when the admin types a number", async () => {
    render(<StaffingTargetsEditor view={view()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /^Day PSW, weekdays/ }), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(actions.saveWeeklyTargets).toHaveBeenCalled());
    // Monday was already 3, so only Tue-Fri change.
    expect(actions.saveWeeklyTargets.mock.calls[0][0].changes).toEqual([
      { templateId: "d", role: "PSW", count: 3, days: ["TUE", "WED", "THU", "FRI"], before: [2, 2, 2, 2] },
    ]);
  });

  it("edits a single day in the By day layout, with arrow keys", async () => {
    render(<StaffingTargetsEditor view={view()} />);
    fireEvent.click(screen.getByRole("radio", { name: "By day" }));
    expect(screen.queryByRole("button", { name: /Increase Day RN, Sat/ })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Day RN, Sat" }), { key: "ArrowUp" });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(actions.saveWeeklyTargets).toHaveBeenCalled());
    expect(actions.saveWeeklyTargets.mock.calls[0][0].changes).toEqual([
      { templateId: "d", role: "RN", count: 5, days: ["SAT"], before: [4] },
    ]);
  });

  it("discards unsaved edits", () => {
    render(<StaffingTargetsEditor view={view()} />);
    fireEvent.click(screen.getByRole("button", { name: "Decrease Day RN, weekends" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("textbox", { name: "Day RN, weekends" })).toHaveValue("4");
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("shows a stale save's message and reloads the latest numbers", async () => {
    actions.saveWeeklyTargets.mockResolvedValue({
      ok: false,
      reason: "STALE",
      message: "Someone else changed these numbers while you were editing.",
    });
    render(<StaffingTargetsEditor view={view()} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase Day RN, weekdays" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Someone else changed these numbers");
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Day RN, weekdays" })).toHaveValue("5");
  });
});

describe("StaffingTargetsEditor - date overrides", () => {
  it("lists upcoming overrides with the usual number and who set them", () => {
    render(<StaffingTargetsEditor view={view()} />);
    const row = within(screen.getByRole("region", { name: "Date overrides" }))
      .getAllByRole("listitem")
      .find((li) => li.textContent?.includes("Census 31 of 30"))!;
    expect(row).toHaveTextContent("Sat, Jan 5");
    expect(row).toHaveTextContent("(usually 4)");
    expect(row).toHaveTextContent("Set by Sarah Chen");
  });

  it("sets a date's number, telling the server there was no override yet", async () => {
    render(<StaffingTargetsEditor view={view()} />);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2030-01-07" } });
    expect(screen.getByText(/Usually 5 on Mondays/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Increase Number needed on that date" }));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Census spike" } });
    fireEvent.click(screen.getByRole("button", { name: "Set for this date" }));
    await waitFor(() =>
      expect(actions.setTargetOverride).toHaveBeenCalledWith({
        templateId: "d",
        date: "2030-01-07",
        role: "RN",
        count: 6,
        reason: "Census spike",
        expected: null,
      })
    );
  });

  it("starts from an existing override and offers to put it back to the usual number", async () => {
    render(<StaffingTargetsEditor view={view()} />);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2030-01-05" } });
    expect(screen.getByText(/currently set to 6 for Sat, Jan 5/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Decrease Number needed on that date" }));
    fireEvent.click(screen.getByRole("button", { name: "Decrease Number needed on that date" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to usual" }));
    await waitFor(() =>
      expect(actions.setTargetOverride).toHaveBeenCalledWith(expect.objectContaining({ count: 4, expected: 6 }))
    );
  });

  it("refuses a past date in the form", () => {
    render(<StaffingTargetsEditor view={view()} />);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2029-12-31" } });
    expect(screen.getByText("Pick today or a later date.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set for this date" })).toBeDisabled();
  });

  it("removes an override", async () => {
    render(<StaffingTargetsEditor view={view()} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove override: Day RN on Sat, Jan 5" }));
    await waitFor(() => expect(actions.removeTargetOverride).toHaveBeenCalledWith({ overrideId: "o1" }));
  });
});

describe("StaffingTargetsEditor - shifts and history", () => {
  it("switches the department to 12-hour shifts", async () => {
    render(<StaffingTargetsEditor view={view()} />);
    fireEvent.click(screen.getByRole("radio", { name: /12-hour shifts/ }));
    await waitFor(() =>
      expect(actions.setShiftPattern).toHaveBeenCalledWith({ departmentId: "dept-med", from: "EIGHT_HOUR", to: "TWELVE_HOUR" })
    );
  });

  it("saves new shift times and blocks a zero-length shift", async () => {
    render(<StaffingTargetsEditor view={view()} />);
    const shifts = screen.getByRole("region", { name: "Shifts" });
    const dayStart = within(shifts).getAllByLabelText("Starts")[0];
    const dayEnd = within(shifts).getAllByLabelText("Ends")[0];

    fireEvent.change(dayEnd, { target: { value: "420" } });
    expect(within(shifts).getByRole("alert")).toHaveTextContent("A shift can't start and end at the same time.");
    expect(within(shifts).getByRole("button", { name: "Save Day" })).toBeDisabled();

    fireEvent.change(dayStart, { target: { value: "450" } });
    fireEvent.change(dayEnd, { target: { value: "930" } });
    fireEvent.click(within(shifts).getByRole("button", { name: "Save Day" }));
    await waitFor(() =>
      expect(actions.updateShiftTemplate).toHaveBeenCalledWith({
        templateId: "d",
        before: { startMinute: 420, endMinute: 900, leadRequired: true },
        after: { startMinute: 450, endMinute: 930, leadRequired: true },
      })
    );
  });

  it("shows who changed what in the change history", () => {
    render(<StaffingTargetsEditor view={view()} />);
    const history = screen.getByRole("region", { name: "Change history" });
    expect(history).toHaveTextContent("Day RN, Weekdays: 4 → 5");
    expect(history).toHaveTextContent("Sarah Chen");
  });
});
