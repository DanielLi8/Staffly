import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { hospitalInstant } from "@/lib/timezone";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const actions = vi.hoisted(() => ({
  saveAvailability: vi.fn(),
  restoreAvailability: vi.fn(),
  loadAvailabilityContext: vi.fn(),
}));
vi.mock("@/app/actions/availability", () => actions);
vi.mock("@/features/shift-swap/shift-swap-panel", () => ({ ShiftSwapPanel: () => null }));

import { AvailabilityEditor } from "@/features/availability/availability-editor";

const WEEK = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];

function availabilityRow(id: string, day: string, start: number, end: number, status: "AVAILABLE" | "UNAVAILABLE" = "AVAILABLE") {
  return { id, startsAt: hospitalInstant(day, start), endsAt: hospitalInstant(day, end), status };
}

function renderEditor(availability: ReturnType<typeof availabilityRow>[]) {
  render(
    <AvailabilityEditor
      heading={<h1>Week</h1>}
      controls={null}
      view="week"
      dayKeys={WEEK}
      monthKey="2026-10"
      todayKey="2026-10-19"
      anchorKey="2026-10-19"
      shifts={[
        {
          id: "s1",
          startsAt: hospitalInstant("2026-10-19", 420),
          endsAt: hospitalInstant("2026-10-19", 1140),
          roleNeeded: "Registered Nurse",
          department: { name: "Emergency", code: "ER" },
        },
      ]}
      availability={availability}
    />
  );
}

function editor() {
  return within(screen.getByRole("region", { name: "Set availability" }));
}

describe("AvailabilityEditor", () => {
  beforeEach(() => {
    actions.saveAvailability.mockReset().mockResolvedValue({ ok: true, count: 1, dateLabel: "Oct 19", previous: [] });
  });

  // Regression: the editor used to open on a hard-coded 7:00 AM-3:00 PM block
  // and Submit replaced the day's saved 06:00-20:00 with it.
  it("opens on the day's SAVED availability, and saving untouched keeps it", async () => {
    renderEditor([availabilityRow("a1", "2026-10-19", 360, 1200)]);

    fireEvent.click(screen.getByRole("button", { name: "Set availability" }));

    expect(editor().getByText("Available 06:00 – 20:00")).toBeInTheDocument();
    expect(editor().getByRole("button", { name: "Custom times" })).toHaveAttribute("aria-pressed", "true");
    expect(editor().getByRole("combobox", { name: "Time range 1 start" })).toHaveValue("360");
    expect(editor().getByRole("combobox", { name: "Time range 1 end" })).toHaveValue("1200");

    fireEvent.click(editor().getByRole("button", { name: "Save for 1 day" }));

    await waitFor(() => expect(actions.saveAvailability).toHaveBeenCalledTimes(1));
    expect(actions.saveAvailability).toHaveBeenCalledWith({
      dates: ["2026-10-19"],
      blocks: [{ status: "AVAILABLE", startMinute: 360, endMinute: 1200 }],
    });
  });

  it("says clearly that saving replaces days whose availability differs, and makes you choose", () => {
    renderEditor([availabilityRow("a1", "2026-10-19", 360, 1200), availabilityRow("a2", "2026-10-20", 0, 1440, "UNAVAILABLE")]);

    fireEvent.click(screen.getByRole("button", { name: "Set availability" }));
    fireEvent.click(editor().getByRole("radio", { name: "Whole week" }));

    expect(editor().getByText(/Saving replaces all of them/)).toBeInTheDocument();
    expect(editor().getByRole("button", { name: "Save for 7 days" })).toBeDisabled();
    expect(editor().getByText("Pick a preset or Custom.")).toBeInTheDocument();
  });

  it("applies a preset to a week with one day ticked off, and marks the days on the grid", async () => {
    renderEditor([]);

    fireEvent.click(screen.getByRole("button", { name: "Set availability" }));
    fireEvent.click(editor().getByRole("radio", { name: "Whole week" }));
    fireEvent.click(editor().getByRole("button", { name: "Saturday, October 24" }));
    fireEvent.click(editor().getByRole("button", { name: /^Days/ }));

    expect(editor().getByText("Will change 6 days")).toBeInTheDocument();
    const grid = within(screen.getByRole("region", { name: "Your week schedule" }));
    expect(grid.getByRole("button", { name: "Monday, October 19, today, will change" })).toBeInTheDocument();
    expect(grid.getByRole("button", { name: "Saturday, October 24" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(editor().getByRole("button", { name: "Save for 6 days" }));
    await waitFor(() => expect(actions.saveAvailability).toHaveBeenCalledTimes(1));
    expect(actions.saveAvailability).toHaveBeenCalledWith({
      dates: ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-25"],
      blocks: [{ status: "AVAILABLE", startMinute: 420, endMinute: 1140 }],
    });
  });

  it("warns in amber when the choice would leave a shift outside availability", () => {
    renderEditor([]);
    fireEvent.click(screen.getByRole("button", { name: "Set availability" }));
    fireEvent.click(editor().getByRole("button", { name: /^Nights/ }));
    expect(editor().getByText("A shift would fall outside this availability")).toBeInTheDocument();
  });
});
