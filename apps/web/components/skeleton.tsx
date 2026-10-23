import { cn } from "@cohory/ui/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-md bg-surface-hover motion-safe:animate-pulse", className)}
    />
  );
}
