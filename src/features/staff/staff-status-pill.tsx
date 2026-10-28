import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAFF_STATUS_LABEL, type StaffStatus } from "@/lib/staff/accounts";

const STATUS_CLASS: Record<StaffStatus, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-800 border-emerald-200",
  PENDING: "bg-amber-50 text-amber-800 border-amber-200",
  DEACTIVATED: "bg-neutral-100 text-neutral-600 border-neutral-200",
};

export function StaffStatusPill({ status, className }: { status: StaffStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-bold uppercase tracking-wide",
        STATUS_CLASS[status],
        className
      )}
    >
      {STAFF_STATUS_LABEL[status]}
    </span>
  );
}

export function TeamLeadPill() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-primary-50 px-2 py-0.5 text-2xs font-bold uppercase tracking-wide text-primary-700">
      <ShieldCheck className="h-3 w-3" aria-hidden />
      Team Lead
    </span>
  );
}
