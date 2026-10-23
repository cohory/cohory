"use client";

import { cva, type VariantProps } from "class-variance-authority";

import { Tooltip, TooltipContent, TooltipTrigger } from "../primitives/tooltip";
import { cn } from "../lib/utils";
import { clampLevel } from "./types";

const levelBadgeVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full bg-accent-muted font-medium whitespace-nowrap text-text tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
  {
    variants: {
      size: {
        sm: "h-5 min-w-5 px-1.5 text-xs",
        md: "h-6 px-2 text-xs",
      },
    },
    defaultVariants: {
      size: "sm",
    },
  },
);

interface LevelBadgeProps extends VariantProps<typeof levelBadgeVariants> {
  level: number;
  name?: string | null;
  disabled?: boolean;
  className?: string;
}

function LevelBadge({ level, name, size, disabled = false, className }: LevelBadgeProps) {
  if (disabled) return null;
  const value = clampLevel(level);
  const label = name ? `Level ${value}, ${name}` : `Level ${value}`;
  const badge = (
    <span
      data-slot="level-badge"
      aria-label={label}
      role="img"
      tabIndex={name ? 0 : undefined}
      className={cn(levelBadgeVariants({ size }), className)}
    >
      <span aria-hidden="true">{size === "md" ? `Level ${value}` : value}</span>
    </span>
  );
  if (!name) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  );
}

export { LevelBadge, levelBadgeVariants, type LevelBadgeProps };
