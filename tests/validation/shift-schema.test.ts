import { describe, it, expect } from "vitest";
import { z } from "zod";
import { addHours, subHours } from "date-fns";

const createShiftSchema = z.object({
  unit: z.string().min(1, "Unit is required"),
  departmentId: z.string().min(1, "Department is required"),
  roleNeeded: z.string().min(1, "Role is required"),
  location: z.string().min(1, "Location is required"),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  bidDeadlineAt: z.coerce.date(),
  notes: z.string().optional(),
});

const start = addHours(new Date(), 8);
const validShift = {
  unit: "4B",
  departmentId: "clDept_emergency",
  roleNeeded: "Registered Nurse",
  location: "St. Michael's Hospital",
  startsAt: start,
  endsAt: addHours(start, 8),
  bidDeadlineAt: subHours(start, 5),
};

describe("createShiftSchema", () => {
  it("accepts a valid shift", () => {
    const result = createShiftSchema.safeParse(validShift);
    expect(result.success).toBe(true);
  });

  it("rejects missing unit", () => {
    const result = createShiftSchema.safeParse({ ...validShift, unit: "" });
    expect(result.success).toBe(false);
  });

  it("coerces string date to Date", () => {
    const result = createShiftSchema.safeParse({
      ...validShift,
      startsAt: addHours(new Date(), 2).toISOString(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startsAt).toBeInstanceOf(Date);
    }
  });
});
