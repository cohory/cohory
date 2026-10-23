"use client";

import type { GalleryItemView } from "@cohory/communities";
import { Badge, Input } from "@cohory/ui";
import { GripVertical } from "lucide-react";
import { useState, type DragEvent } from "react";

import { VideoPoster } from "../about/video-poster";
import { GalleryItemActions } from "./gallery-item-actions";
import { StoredImage } from "../stored-image";

export function GalleryRow({
  item,
  label,
  index,
  count,
  pending,
  onMove,
  onRemove,
  onAltText,
  onDragStart,
  onDrop,
}: {
  item: GalleryItemView;
  label: string;
  index: number;
  count: number;
  pending: boolean;
  onMove(to: number): void;
  onRemove(): void;
  onAltText(text: string): void;
  onDragStart(): void;
  onDrop(): void;
}) {
  const [alt, setAlt] = useState(item.altText ?? "");
  return (
    <li
      draggable={!pending}
      onDragStart={(event: DragEvent) => {
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-md border border-border bg-surface p-2 sm:grid-cols-[auto_7rem_minmax(0,1fr)_auto]"
    >
      <GripVertical
        aria-hidden="true"
        className="hidden size-5 cursor-grab text-text-muted sm:row-span-2 sm:block"
        strokeWidth={1.5}
      />
      <div className="aspect-video w-full overflow-hidden rounded-md bg-surface-hover sm:row-span-2">
        {item.kind === "image" ? (
          // Gallery images come from the storage driver's public URL, which may be any S3 host.
          <StoredImage src={item.url} alt="" className="size-full object-cover" />
        ) : (
          <VideoPoster item={item} />
        )}
      </div>
      <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-text">
        <span className="truncate">{label}</span>
        {index === 0 ? <Badge>Hero</Badge> : null}
      </p>
      <div className="sm:col-start-4 sm:row-span-2 sm:row-start-1">
        <GalleryItemActions
          label={label}
          itemId={item.id}
          index={index}
          count={count}
          disabled={pending}
          onMove={onMove}
          onRemove={onRemove}
        />
      </div>
      <Input
        aria-label={`Alt text for ${label}`}
        placeholder="Describe it for screen readers"
        value={alt}
        maxLength={250}
        disabled={pending}
        onChange={(event) => setAlt(event.target.value)}
        onBlur={() => {
          if (alt.trim() !== (item.altText ?? "")) onAltText(alt);
        }}
        className="col-span-3 min-h-11 sm:col-span-1 sm:col-start-3"
      />
    </li>
  );
}
