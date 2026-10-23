import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-md border border-input bg-surface px-3 py-2 text-base text-text transition-colors duration-(--duration-fast) ease-(--ease-standard) outline-none placeholder:text-text-subtle focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-text-subtle aria-invalid:border-danger sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
