import { cn } from "@/lib/utils";
import type { ShiftStatus, BidStatus } from "@/types";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "outline";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border",
        variant === "default" && "bg-neutral-100 text-neutral-700 border-neutral-200",
        className
      )}
      {...props}
    />
  );
}

const shiftStatusMap: Record<ShiftStatus, string> = {
  OPEN: "status-open",
  ASSIGNED: "status-assigned",
  CLOSED: "status-closed",
  CANCELLED: "status-cancelled",
};

const shiftStatusLabel: Record<ShiftStatus, string> = {
  OPEN: "OPEN",
  ASSIGNED: "ASSIGNED",
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
};

export function ShiftStatusBadge({ status }: { status: ShiftStatus }) {
  return (
    <Badge className={cn("border text-[10px] font-bold tracking-wide uppercase", shiftStatusMap[status])}>
      {shiftStatusLabel[status]}
    </Badge>
  );
}

const bidStatusMap: Record<BidStatus, string> = {
  PENDING: "bid-pending",
  SELECTED: "bid-selected",
  NOT_SELECTED: "bid-not-selected",
};

const bidStatusLabel: Record<BidStatus, string> = {
  PENDING: "Pending",
  SELECTED: "Assigned",
  NOT_SELECTED: "Not selected",
};

export function BidStatusBadge({ status }: { status: BidStatus }) {
  return (
    <Badge className={cn("border", bidStatusMap[status])}>
      {bidStatusLabel[status]}
    </Badge>
  );
}
