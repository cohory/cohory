"use client";

import { EllipsisIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../primitives/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../primitives/tooltip";
import { Link } from "../lib/link";
import { cn } from "../lib/utils";

interface ItemAction {
  id: string;
  label: string;
  onSelect(): void;
  href?: string;
  icon?: ReactNode;
  variant?: "default" | "danger";
  disabled?: boolean;
}

interface ItemActionsMenuProps {
  actions: ItemAction[];
  label: string;
  className?: string;
}

function ItemActionsMenu({ actions, label, className }: ItemActionsMenuProps) {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            aria-label={label}
            className={cn(
              "relative z-(--z-raised) inline-flex size-11 items-center justify-center rounded-md text-text-muted transition-colors duration-(--duration-fast) outline-none hover:bg-surface-hover hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
              className,
            )}
          >
            <EllipsisIcon className="size-4" aria-hidden="true" />
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        {actions.map((action, index) => (
          <Fragment key={action.id}>
            {index > 0 &&
            action.variant === "danger" &&
            actions[index - 1]?.variant !== "danger" ? (
              <DropdownMenuSeparator />
            ) : null}
            <DropdownMenuItem
              variant={action.variant ?? "default"}
              disabled={action.disabled}
              onSelect={action.onSelect}
              asChild={action.href !== undefined}
            >
              {action.href !== undefined ? (
                <Link href={action.href}>
                  {action.icon}
                  {action.label}
                </Link>
              ) : (
                <>
                  {action.icon}
                  {action.label}
                </>
              )}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { ItemActionsMenu, type ItemAction, type ItemActionsMenuProps };
