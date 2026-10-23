"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-input bg-surface-hover p-0.5 transition-colors duration-(--duration-fast) ease-(--ease-standard) outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-accent motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4.5 rounded-full bg-text-muted shadow-sm transition-transform duration-(--duration-fast) ease-(--ease-standard) data-[state=checked]:translate-x-5 data-[state=checked]:bg-accent-foreground motion-reduce:transition-none"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
