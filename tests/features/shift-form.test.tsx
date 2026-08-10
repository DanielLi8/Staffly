import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ShiftForm } from "@/features/shifts/shift-form";
import { SHIFT_TIME_MESSAGES } from "@/lib/shifts/validation";

const createShift = vi.fn();

vi.mock("@/app/actions/shifts", () => ({
  createShift: (...args: unknown[]) => createShift(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

const departments = [{ id: "dept_1", name: "Emergency", code: "ED" }];

function setup() {
  render(<ShiftForm departments={departments} />);
  return {
    startDate: screen.getByLabelText("Shift starts") as HTMLInputElement,
    startTime: screen.getByLabelText("Shift starts time") as HTMLInputElement,
    endDate: screen.getByLabelText("Shift ends") as HTMLInputElement,
    endTime: screen.getByLabelText("Shift ends time") as HTMLInputElement,
    deadlineDate: screen.getByLabelText("Bid deadline") as HTMLInputElement,
    deadlineTime: screen.getByLabelText("Bid deadline time") as HTMLInputElement,
    submit: screen.getByRole("button", { name: /submit shift/i }),
  };
}

function fillRequiredDetails() {
  fireEvent.change(screen.getByLabelText(/unit \/ department/i), {
    target: { value: "dept_1" },
  });
  fireEvent.change(screen.getByLabelText(/role needed/i), {
    target: { value: "Emergency MD" },
  });
  fireEvent.change(screen.getByLabelText(/unit \/ floor/i), {
    target: { value: "4B" },
  });
  fireEvent.change(screen.getByLabelText(/specific location/i), {
    target: { value: "Building B" },
  });
}

describe("ShiftForm", () => {
  beforeEach(() => {
    createShift.mockReset();
  });

  it("autofills a 7:00 AM - 7:00 PM day shift", () => {
    const f = setup();
    expect(f.startTime.value).toBe("7:00 AM");
    expect(f.endTime.value).toBe("7:00 PM");
    expect(f.startDate.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(f.endDate.value).toBe(f.startDate.value);
  });

  it("uses typeable text time inputs rather than a native time picker", () => {
    const f = setup();
    expect(f.startTime.type).toBe("text");
    fireEvent.change(f.startTime, { target: { value: "9:15 pm" } });
    expect(f.startTime.value).toBe("9:15 pm");
  });

  // Regression for #7: this submission used to throw on the server and reach
  // the scheduler as the sanitized "digest" message.
  it("blocks a bid deadline less than 4 hours before the start", async () => {
    const f = setup();
    fillRequiredDetails();
    fireEvent.change(f.deadlineDate, { target: { value: f.startDate.value } });
    fireEvent.change(f.deadlineTime, { target: { value: "5:00 AM" } });
    fireEvent.click(f.submit);

    expect(
      await screen.findByText(SHIFT_TIME_MESSAGES.deadlineTooClose)
    ).toBeInTheDocument();
    expect(createShift).not.toHaveBeenCalled();
    expect(screen.queryByText(/digest/i)).not.toBeInTheDocument();
  });

  it("blocks a bid deadline at or after the shift start", async () => {
    const f = setup();
    fillRequiredDetails();
    fireEvent.change(f.deadlineDate, { target: { value: f.startDate.value } });
    fireEvent.change(f.deadlineTime, { target: { value: "10:00 AM" } });
    fireEvent.click(f.submit);

    expect(
      await screen.findByText(SHIFT_TIME_MESSAGES.deadlineAfterStart)
    ).toBeInTheDocument();
    expect(createShift).not.toHaveBeenCalled();
  });

  it("blocks an end time that is not after the start", async () => {
    const f = setup();
    fillRequiredDetails();
    fireEvent.change(f.endTime, { target: { value: "6:00 AM" } });
    fireEvent.click(f.submit);

    expect(
      await screen.findByText(SHIFT_TIME_MESSAGES.endBeforeStart)
    ).toBeInTheDocument();
    expect(createShift).not.toHaveBeenCalled();
  });

  it("flags unreadable time text", async () => {
    const f = setup();
    fillRequiredDetails();
    fireEvent.change(f.startTime, { target: { value: "sevenish" } });
    fireEvent.click(f.submit);

    expect(await screen.findByText(/enter a time like/i)).toBeInTheDocument();
    expect(createShift).not.toHaveBeenCalled();
  });

  it("submits the defaults and passes real Dates to the action", async () => {
    const f = setup();
    fillRequiredDetails();
    fireEvent.click(f.submit);

    await waitFor(() => expect(createShift).toHaveBeenCalledTimes(1));
    const payload = createShift.mock.calls[0][0];
    expect(payload.startsAt).toBeInstanceOf(Date);
    expect(payload.startsAt.getHours()).toBe(7);
    expect(payload.endsAt.getHours()).toBe(19);
    expect(payload.bidDeadlineAt.getTime()).toBeLessThan(payload.startsAt.getTime());
    expect(payload.unit).toBe("4B");
  });

  it("renders field errors returned by the server action", async () => {
    createShift.mockResolvedValue({
      ok: false,
      fieldErrors: { bidDeadlineAt: SHIFT_TIME_MESSAGES.deadlineTooClose },
      formError: "Please correct the highlighted fields.",
    });
    const f = setup();
    fillRequiredDetails();
    fireEvent.click(f.submit);

    expect(
      await screen.findByText(SHIFT_TIME_MESSAGES.deadlineTooClose)
    ).toBeInTheDocument();
    expect(
      screen.getByText("Please correct the highlighted fields.")
    ).toBeInTheDocument();
  });
});
