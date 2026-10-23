"use client";

import * as ProgressPrimitive from "@radix-ui/react-progress";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

function Progress({
  className,
  value,
  max = 100,
  ...props
}: ComponentProps<typeof ProgressPrimitive.Root>) {
  const ratio = value === null || value === undefined ? 0 : Math.min(Math.max(value / max, 0), 1);
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      max={max}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-border", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full rounded-full bg-accent transition-transform duration-(--duration-slow) ease-(--ease-standard) motion-reduce:transition-none"
        style={{ transform: `translateX(-${100 - ratio * 100}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
