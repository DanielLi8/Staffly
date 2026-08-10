import type { ShiftStatus } from "@prisma/client";

export function canCancelShift(status: ShiftStatus): boolean {
  return status === "OPEN" || status === "ASSIGNED";
}
