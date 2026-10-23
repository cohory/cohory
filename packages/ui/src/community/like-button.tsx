"use client";

import { HeartIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { formatCount } from "../lib/format-number";
import { cn } from "../lib/utils";

type LikeButtonProps = Omit<ComponentProps<"button">, "onClick" | "children"> & {
  liked: boolean;
  count: number;
  onToggle(): void;
};

function likeLabel(count: number): string {
  return count === 1 ? "Like, 1 like" : `Like, ${formatCount(count)} likes`;
}

function LikeButton({ liked, count, onToggle, className, ...props }: LikeButtonProps) {
  return (
    <button
      type="button"
      data-slot="like-button"
      aria-pressed={liked}
      aria-label={likeLabel(count)}
      onClick={onToggle}
      className={cn(
        "relative inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium transition-colors duration-(--duration-fast) ease-(--ease-standard) outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:text-text-subtle",
        liked ? "text-accent" : "text-text-muted",
        className,
      )}
      {...props}
    >
      <HeartIcon
        className={cn("size-4", liked && "fill-current")}
        aria-hidden="true"
        strokeWidth={2}
      />
      <span aria-hidden="true" className="tabular-nums">
        {formatCount(count)}
      </span>
    </button>
  );
}

export { LikeButton, type LikeButtonProps };
