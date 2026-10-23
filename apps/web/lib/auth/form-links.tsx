import { cn } from "@cohory/ui/lib/utils";
import Link from "next/link";
import type { ComponentProps } from "react";

export function TextLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        "rounded-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        className,
      )}
      {...props}
    />
  );
}

export function withNext(path: string, next: string): string {
  return next === "/" ? path : `${path}?next=${encodeURIComponent(next)}`;
}
