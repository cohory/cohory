"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "text-sm font-medium text-text select-none peer-disabled:cursor-not-allowed peer-disabled:text-text-subtle",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
