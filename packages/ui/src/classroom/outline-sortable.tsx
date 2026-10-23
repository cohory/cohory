"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { GripVerticalIcon } from "lucide-react";
import {
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { cn } from "../lib/utils";

export interface Grab {
  moduleId: string | null;
  itemId: string;
  original: string[];
  ids: string[];
}

export interface Item {
  id: string;
  title: string;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(callback: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => typeof window !== "undefined" && !!window.matchMedia?.(REDUCED_MOTION).matches,
    () => false,
  );
}

export function position(ids: string[], id: string): string {
  return `position ${ids.indexOf(id) + 1} of ${ids.length}`;
}

export function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function ordered<T extends Item>(items: T[], ids: string[] | undefined): T[] {
  if (!ids) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

export interface ReorderApi {
  grab: Grab | null;
  instructionsId: string;
  reducedMotion: boolean;
  registerHandle(id: string, element: HTMLButtonElement | null): void;
  onHandleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    moduleId: string | null,
    items: Item[],
    item: Item,
  ): void;
}

export function SortableRow({
  item,
  moduleId,
  items,
  api,
  className,
  children,
  below,
}: {
  item: Item;
  moduleId: string | null;
  items: Item[];
  api: ReorderApi;
  className?: string;
  children: ReactNode;
  below?: ReactNode;
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } =
    useSortable({ id: item.id, transition: api.reducedMotion ? null : undefined });
  const grabbed = api.grab?.itemId === item.id;
  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition: api.reducedMotion ? undefined : transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-grabbed={grabbed || undefined}
      data-dragging={isDragging || undefined}
      className={cn(
        "relative rounded-md bg-surface",
        (grabbed || isDragging) && "z-(--z-raised) ring-2 ring-ring shadow-md",
        className,
      )}
    >
      <div className="flex min-h-11 items-center gap-2">
        <button
          type="button"
          ref={(element) => {
            setActivatorNodeRef(element);
            api.registerHandle(item.id, element);
          }}
          aria-label={`Reorder ${item.title}`}
          aria-describedby={api.instructionsId}
          aria-pressed={grabbed}
          onKeyDown={(event) => api.onHandleKeyDown(event, moduleId, items, item)}
          {...listeners}
          className="inline-flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-text-muted outline-none hover:bg-surface-hover hover:text-text focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        >
          <GripVerticalIcon className="size-4" aria-hidden="true" />
        </button>
        {children}
      </div>
      {below}
    </li>
  );
}

export function SortableList({
  moduleId,
  items,
  onReorder,
  onAnnounce,
  label,
  className,
  children,
}: {
  moduleId: string | null;
  items: Item[];
  onReorder(moduleId: string | null, orderedIds: string[]): void;
  onAnnounce(message: string): void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const ids = items.map((item) => item.id);
  const title = (id: string | number) => items.find((item) => item.id === id)?.title ?? "";

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) {
      onAnnounce(`${title(active.id)} dropped. No change.`);
      return;
    }
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    const next = arrayMove(ids, from, to);
    onReorder(moduleId, next);
    onAnnounce(`${title(active.id)} dropped at ${position(next, String(active.id))}.`);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) =>
        onAnnounce(`Picked up ${title(active.id)}. ${position(ids, String(active.id))}.`)
      }
      onDragCancel={({ active }) => onAnnounce(`Reorder cancelled for ${title(active.id)}.`)}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements: {
          onDragStart: () => undefined,
          onDragOver: () => undefined,
          onDragMove: () => undefined,
          onDragEnd: () => undefined,
          onDragCancel: () => undefined,
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul aria-label={label} className={cn("flex flex-col gap-1", className)}>
          {children}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
