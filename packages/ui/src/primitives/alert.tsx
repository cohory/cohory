import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

const alertVariants = cva(
  "relative flex w-full flex-col gap-1 rounded-md border px-4 py-3 text-sm text-text",
  {
    variants: {
      variant: {
        info: "border-info bg-info-muted",
        success: "border-success bg-success-muted",
        warning: "border-warning bg-warning-muted",
        danger: "border-danger bg-danger-muted",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  },
);

type AlertProps = ComponentProps<"div"> & VariantProps<typeof alertVariants>;

function Alert({ className, variant, role, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      role={role ?? (variant === "danger" ? "alert" : "status")}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="alert-title" className={cn("font-medium", className)} {...props} />;
}

function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="alert-description" className={cn("text-text-muted", className)} {...props} />
  );
}

export { Alert, AlertDescription, AlertTitle, alertVariants, type AlertProps };
