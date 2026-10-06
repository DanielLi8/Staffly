import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ScheduleSearchBox } from "@/features/location-schedule/schedule-search-box";

const push = vi.fn();
const searchScheduleTargets = vi.fn();
const getDefaultScheduleTargets = vi.fn();

vi.mock("@/app/actions/schedule-search", () => ({
  searchScheduleTargets: (...args: unknown[]) => searchScheduleTargets(...args),
  getDefaultScheduleTargets: (...args: unknown[]) => getDefaultScheduleTargets(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const departments = [
  { type: "department" as const, id: "dept_er", name: "Emergency Department", code: "ER" },
  { type: "department" as const, id: "dept_icu", name: "Intensive Care Unit", code: "ICU" },
];

const staff = [
  { type: "staff" as const, id: "user_1", name: "Aisha Patel", position: "Registered Nurse", department: "ICU" },
  { type: "staff" as const, id: "user_2", name: "David Kim", position: "Registered Nurse", department: "ICU" },
];

describe("ScheduleSearchBox", () => {
  beforeEach(() => {
    push.mockReset();
    searchScheduleTargets.mockReset();
    getDefaultScheduleTargets.mockReset();
    getDefaultScheduleTargets.mockImplementation(async (scope: string) =>
      scope === "staff" ? staff : departments
    );
  });

  it("shows a department dropdown on focus with no text typed", async () => {
    render(<ScheduleSearchBox />);
    fireEvent.focus(screen.getByLabelText("Search departments"));

    expect(await screen.findByText("Emergency Department")).toBeInTheDocument();
    expect(screen.getByText("Intensive Care Unit")).toBeInTheDocument();
    expect(searchScheduleTargets).not.toHaveBeenCalled();
  });

  it("shows a staff dropdown on focus with no text typed", async () => {
    render(<ScheduleSearchBox />);
    fireEvent.focus(screen.getByLabelText("Search staff"));

    expect(await screen.findByText("Aisha Patel")).toBeInTheDocument();
    expect(screen.getByText("David Kim")).toBeInTheDocument();
    expect(searchScheduleTargets).not.toHaveBeenCalled();
  });

  it("still filters via searchScheduleTargets once typing starts", async () => {
    searchScheduleTargets.mockResolvedValue([
      { type: "department" as const, id: "dept_er", name: "Emergency Department", code: "ER" },
    ]);
    render(<ScheduleSearchBox />);
    const input = screen.getByLabelText("Search departments");
    fireEvent.focus(input);
    await screen.findByText("Intensive Care Unit");

    fireEvent.change(input, { target: { value: "emer" } });

    await waitFor(() => expect(searchScheduleTargets).toHaveBeenCalledWith("emer", "department"));
    expect(await screen.findByText("Emergency Department")).toBeInTheDocument();
    expect(screen.queryByText("Intensive Care Unit")).not.toBeInTheDocument();
  });

  it("navigates to the selected result exactly as a typed selection would", async () => {
    render(<ScheduleSearchBox />);
    fireEvent.focus(screen.getByLabelText("Search departments"));

    fireEvent.click(await screen.findByText("Emergency Department"));

    expect(push).toHaveBeenCalledWith("/admin/schedule?type=department&id=dept_er&view=week");
  });
});
