import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

const badgeVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        accent: "bg-accent-muted text-text",
        neutral: "border border-border bg-surface text-text-muted",
        count: "min-w-5 bg-danger px-1.5 text-danger-foreground",
        success: "bg-success-muted text-success",
        warning: "bg-warning-muted text-warning",
      },
    },
    defaultVariants: {
      variant: "accent",
    },
  },
);

type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant, className }))} {...props} />
  );
}

export { Badge, badgeVariants, type BadgeProps };
