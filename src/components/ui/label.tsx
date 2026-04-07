import { cn } from "@/lib/utils";
import { forwardRef, type LabelHTMLAttributes } from "react";

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn("block text-sm font-medium text-neutral-700 mb-1", className)}
      {...props}
    />
  )
);

Label.displayName = "Label";
