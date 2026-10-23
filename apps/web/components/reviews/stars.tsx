import { cn } from "@cohory/ui";
import { Star } from "lucide-react";

export function Stars({
  rating,
  label,
  className,
}: {
  rating: number;
  label?: string;
  className?: string;
}) {
  const filled = Math.round(rating);
  return (
    <span
      role="img"
      aria-label={label ?? `${rating} out of 5 stars`}
      className={cn("inline-flex items-center gap-0.5", className)}
    >
      {[1, 2, 3, 4, 5].map((index) => (
        <Star
          key={index}
          aria-hidden="true"
          strokeWidth={1.5}
          className={cn(
            "size-4",
            index <= filled ? "fill-warning text-warning" : "fill-none text-text-subtle",
          )}
        />
      ))}
    </span>
  );
}
