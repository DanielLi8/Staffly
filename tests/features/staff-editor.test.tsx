import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StaffEditor } from "@/features/staff/staff-editor";
import { STAFF_MESSAGES, type StaffFormInput } from "@/lib/staff/validation";

const createStaffMember = vi.fn();
const updateStaffMember = vi.fn();
vi.mock("@/app/actions/staff", () => ({
  createStaffMember: (...args: unknown[]) => createStaffMember(...args),
  updateStaffMember: (...args: unknown[]) => updateStaffMember(...args),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const departments = [
  { id: "dept-er", name: "Emergency Department", code: "ER" },
  { id: "dept-icu", name: "Intensive Care Unit", code: "ICU" },
  { id: "dept-med", name: "Medical/Surgical", code: "MED" },
];

const initial: StaffFormInput = {
  name: "Priya Sharma",
  employeeId: "",
  position: "Registered Nurse",
  primaryDepartmentId: "dept-icu",
  hireDate: "2023-01-09",
  seniorityRank: "",
  phone: "",
  phoneConfirmed: false,
  isTeamLead: false,
  memberships: [{ departmentId: "dept-icu", title: "RN" }],
};

function renderEdit(overrides: Partial<StaffFormInput> = {}, extra: { legacyPosition?: string } = {}) {
  render(
    <StaffEditor mode="edit" userId="u5" departments={departments} initial={{ ...initial, ...overrides }} {...extra} />
  );
}

function addDepartment(label: string) {
  fireEvent.change(screen.getByLabelText("Add to department"), {
    target: { value: departments.find((d) => d.name === label)!.id },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
}

describe("StaffEditor", () => {
  beforeEach(() => {
    createStaffMember.mockReset();
    updateStaffMember.mockReset();
    push.mockReset();
    refresh.mockReset();
  });

  it("opens on the saved record, offering only the canonical positions", () => {
    renderEdit();
    expect(screen.getByLabelText("Full name")).toHaveValue("Priya Sharma");
    expect(screen.getByLabelText("Position")).toHaveValue("Registered Nurse");
    expect(screen.getByLabelText("Roster title in Intensive Care Unit")).toHaveValue("RN");
    const options = Array.from((screen.getByLabelText("Position") as HTMLSelectElement).options).map((o) => o.text);
    expect(options).toEqual([
      "Choose a position",
      "Registered Nurse (RN)",
      "Registered Practical Nurse (RPN)",
      "Personal Support Worker (PSW)",
      "Certified Nursing Assistant (CNA)",
      "Respiratory Therapist (RT)",
      "Physician (MD)",
    ]);
    // An existing account's email is its sign-in identity: not editable here.
    expect(screen.queryByLabelText("Work email")).toBeNull();
  });

  it("flags a legacy, non-canonical position", () => {
    renderEdit({ position: "" }, { legacyPosition: "Staff Nurse" });
    expect(screen.getByText(/Saved as .Staff Nurse., which isn't a standard position/)).toBeInTheDocument();
  });

  it("edits position and memberships and saves them together", async () => {
    updateStaffMember.mockResolvedValue({ ok: true, id: "u5" });
    renderEdit();

    fireEvent.change(screen.getByLabelText("Position"), { target: { value: "Registered Practical Nurse" } });
    addDepartment("Medical/Surgical");
    // A new membership's title defaults to the position's code.
    expect(screen.getByLabelText("Roster title in Medical/Surgical")).toHaveValue("RPN");
    fireEvent.change(screen.getByLabelText("Roster title in Medical/Surgical"), { target: { value: "Float RPN" } });
    // The department already added is no longer offered.
    expect(screen.queryByRole("option", { name: "Medical/Surgical (MED)" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateStaffMember).toHaveBeenCalledTimes(1));
    expect(updateStaffMember).toHaveBeenCalledWith(
      "u5",
      expect.objectContaining({
        position: "Registered Practical Nurse",
        memberships: [
          { departmentId: "dept-icu", title: "RN" },
          { departmentId: "dept-med", title: "Float RPN" },
        ],
      })
    );
    expect(await screen.findByText("Changes saved")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("removes a membership", async () => {
    updateStaffMember.mockResolvedValue({ ok: true, id: "u5" });
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Remove from Intensive Care Unit" }));
    expect(screen.getByText("Not in any department yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateStaffMember).toHaveBeenCalledWith("u5", expect.objectContaining({ memberships: [] })));
  });

  it("offers a main-department choice only with two or more memberships", () => {
    renderEdit();
    expect(screen.queryByLabelText("Main department")).toBeNull();
    addDepartment("Emergency Department");
    const radios = screen.getAllByRole("radio", { name: "Main department" });
    expect(radios).toHaveLength(2);
    expect(radios[0]).toBeChecked();
  });

  it("blocks an invalid save on the client with the server's messages", async () => {
    renderEdit();
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: " " } });
    fireEvent.change(screen.getByLabelText("Seniority rank (optional)"), { target: { value: "first" } });
    fireEvent.change(screen.getByLabelText("Roster title in Intensive Care Unit"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(STAFF_MESSAGES.nameRequired)).toBeInTheDocument();
    expect(screen.getByText(STAFF_MESSAGES.seniorityInvalid)).toBeInTheDocument();
    expect(screen.getByText(STAFF_MESSAGES.membershipTitleRequired)).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toHaveAttribute("aria-invalid", "true");
    expect(updateStaffMember).not.toHaveBeenCalled();
  });

  it("renders the server's typed field errors inline", async () => {
    updateStaffMember.mockResolvedValue({ ok: false, fieldErrors: { phone: STAFF_MESSAGES.phoneTaken } });
    renderEdit();
    fireEvent.change(screen.getByLabelText("Mobile number (optional)"), { target: { value: "+14165550101" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirmed this number/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(STAFF_MESSAGES.phoneTaken)).toBeInTheDocument();
    expect(screen.getByLabelText("Mobile number (optional)")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Changes saved")).toBeNull();
  });

  it("keeps the confirmation box off until there is a number", () => {
    renderEdit();
    expect(screen.getByRole("checkbox", { name: /I confirmed this number/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Mobile number (optional)"), { target: { value: "+14165550101" } });
    expect(screen.getByRole("checkbox", { name: /I confirmed this number/ })).toBeEnabled();
  });

  it("shows a generic retry message when the action throws", async () => {
    updateStaffMember.mockRejectedValue(new Error("network"));
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Couldn't save. Check your connection and try again.")).toBeInTheDocument();
  });

  it("creates a new hire and opens their record", async () => {
    createStaffMember.mockResolvedValue({ ok: true, id: "new-1" });
    render(
      <StaffEditor
        mode="create"
        departments={departments}
        initial={{ ...initial, name: "", email: "", position: "", memberships: [], primaryDepartmentId: "" }}
      />
    );
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Jordan Lee" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "jordan.lee@hospital.ca" } });
    fireEvent.change(screen.getByLabelText("Position"), { target: { value: "Personal Support Worker" } });
    addDepartment("Emergency Department");
    fireEvent.click(screen.getByRole("button", { name: "Add staff member" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/workers/new-1?added=1"));
    expect(createStaffMember).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "jordan.lee@hospital.ca",
        memberships: [{ departmentId: "dept-er", title: "PSW" }],
      })
    );
  });

  it("requires an email and position for a new hire", async () => {
    render(
      <StaffEditor
        mode="create"
        departments={departments}
        initial={{ ...initial, name: "Jordan Lee", email: "", position: "", memberships: [] }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Add staff member" }));
    expect(await screen.findByText(STAFF_MESSAGES.emailRequired)).toBeInTheDocument();
    expect(screen.getByText(STAFF_MESSAGES.positionRequired)).toBeInTheDocument();
    expect(createStaffMember).not.toHaveBeenCalled();
  });
});
