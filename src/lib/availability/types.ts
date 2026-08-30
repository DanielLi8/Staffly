import type { AvailabilityStatus } from "@prisma/client";

export interface AvailabilityDTO {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: AvailabilityStatus;
}
