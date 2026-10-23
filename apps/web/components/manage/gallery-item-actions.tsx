"use client";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@cohory/ui";
import { ArrowDown, ArrowUp, MoreHorizontal, Star, Trash2 } from "lucide-react";

export function GalleryItemActions({
  label,
  itemId,
  index,
  count,
  disabled,
  onMove,
  onRemove,
}: {
  label: string;
  itemId: string;
  index: number;
  count: number;
  disabled: boolean;
  onMove(to: number): void;
  onRemove(): void;
}) {
  const first = index === 0;
  const last = index === count - 1;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="size-11 px-0"
          aria-label={`Actions for ${label}`}
          data-gallery-actions={itemId}
          disabled={disabled}
        >
          <MoreHorizontal aria-hidden="true" className="size-5" strokeWidth={1.5} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={first} onSelect={() => onMove(index - 1)}>
          <ArrowUp aria-hidden="true" strokeWidth={1.5} />
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem disabled={last} onSelect={() => onMove(index + 1)}>
          <ArrowDown aria-hidden="true" strokeWidth={1.5} />
          Move down
        </DropdownMenuItem>
        <DropdownMenuItem disabled={first} onSelect={() => onMove(0)}>
          <Star aria-hidden="true" strokeWidth={1.5} />
          Make hero
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger" onSelect={onRemove}>
          <Trash2 aria-hidden="true" strokeWidth={1.5} />
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
