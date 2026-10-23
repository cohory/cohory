import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-20 w-full min-w-0 rounded-md border border-input bg-surface px-3 py-2 text-base text-text transition-colors duration-(--duration-fast) ease-(--ease-standard) outline-none placeholder:text-text-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-text-subtle read-only:bg-surface-hover aria-invalid:border-danger sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
