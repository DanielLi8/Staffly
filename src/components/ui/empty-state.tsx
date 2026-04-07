import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 px-6 text-center",
        className
      )}
    >
      {Icon && (
        <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mb-4">
          <Icon className="w-6 h-6 text-neutral-400" aria-hidden="true" />
        </div>
      )}
      <h3 className="text-base font-semibold text-neutral-800 mb-1">{title}</h3>
      {description && <p className="text-sm text-neutral-500 max-w-xs mb-4">{description}</p>}
      {action}
    </div>
  );
}
