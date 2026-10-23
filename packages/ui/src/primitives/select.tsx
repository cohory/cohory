import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div data-slot="select-wrapper" className={cn("relative w-full", className)}>
      <select
        data-slot="select"
        className="flex h-10 w-full min-w-0 appearance-none rounded-md border border-input bg-surface py-2 pr-9 pl-3 text-base text-text transition-colors duration-(--duration-fast) ease-(--ease-standard) outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-text-subtle aria-invalid:border-danger motion-reduce:transition-none sm:text-sm"
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-muted"
      />
    </div>
  );
}

export { Select };
