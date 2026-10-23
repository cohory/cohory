"use client";

import { arrayMove } from "@dnd-kit/sortable";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { EmptyState } from "../community/empty-state";
import { ItemActionsMenu, type ItemAction } from "../community/item-actions";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { cn } from "../lib/utils";
import {
  SortableList,
  SortableRow,
  capitalize,
  ordered,
  position,
  sameOrder,
  useReducedMotion,
  type Grab,
  type Item,
  type ReorderApi,
} from "./outline-sortable";
import {
  ModuleLessons,
  type LessonCallbacks,
  type OutlineEditorLesson,
  type OutlineEditorModule,
} from "./outline-lessons";

interface OutlineEditorProps extends LessonCallbacks {
  modules: OutlineEditorModule[];
  onAddModule(): Promise<string | null>;
  onRenameModule(moduleId: string, title: string): void;
  onDeleteModule(moduleId: string): void;
  onAddLesson(moduleId: string, title: string): Promise<boolean>;
  onReorder(moduleId: string | null, orderedIds: string[]): void;
  className?: string;
}

function ModuleTitleForm({
  title,
  onCancel,
  onRename,
}: {
  title: string;
  onCancel(): void;
  onRename(title: string): void;
}) {
  const [draft, setDraft] = useState(title);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draft.trim();
    if (next && next !== title) onRename(next);
    else onCancel();
  }

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-2">
      <Input
        autoFocus
        value={draft}
        aria-label="Module title"
        maxLength={120}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        className="h-9"
      />
      <Button type="submit" size="sm">
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

function ModuleTitle({
  module,
  editing,
  onStartEditing,
  onCancel,
  onRename,
}: {
  module: OutlineEditorModule;
  editing: boolean;
  onStartEditing(): void;
  onCancel(): void;
  onRename(title: string): void;
}) {
  if (editing) {
    return <ModuleTitleForm title={module.title} onCancel={onCancel} onRename={onRename} />;
  }
  return (
    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
      <button
        type="button"
        onClick={onStartEditing}
        className="max-w-full truncate rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {module.title}
      </button>
    </h3>
  );
}

function OutlineEditor({
  modules,
  onAddModule,
  onRenameModule,
  onDeleteModule,
  onAddLesson,
  onReorder,
  className,
  ...lessonCallbacks
}: OutlineEditorProps) {
  const instructionsId = useId();
  const reducedMotion = useReducedMotion();
  const [grab, setGrab] = useState<Grab | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingModule, setAddingModule] = useState(false);
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const dropped = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!grab) return;
    const handle = handles.current.get(grab.itemId);
    if (handle && document.activeElement !== handle) handle.focus();
  }, [grab]);

  useLayoutEffect(() => {
    const id = dropped.current;
    if (!id) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    handles.current.get(id)?.focus();
  }, [modules]);

  async function addModule() {
    if (addingModule) return;
    setAddingModule(true);
    try {
      const id = await onAddModule();
      if (id) setEditingId(id);
    } finally {
      setAddingModule(false);
    }
  }

  function onHandleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    moduleId: string | null,
    items: Item[],
    item: Item,
  ) {
    const active = grab && grab.itemId === item.id ? grab : null;

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (!active) {
        const ids = items.map((entry) => entry.id);
        dropped.current = null;
        setGrab({ moduleId, itemId: item.id, original: ids, ids });
        setAnnouncement(
          `Picked up ${item.title}. ${capitalize(position(ids, item.id))}. Use the arrow keys to move, Space to drop, Escape to cancel.`,
        );
        return;
      }
      setGrab(null);
      dropped.current = item.id;
      if (!sameOrder(active.ids, active.original)) onReorder(active.moduleId, active.ids);
      setAnnouncement(`${item.title} dropped at ${position(active.ids, item.id)}.`);
      return;
    }

    if (!active) return;

    if (event.key === "Escape") {
      event.preventDefault();
      setGrab(null);
      setAnnouncement(
        `Reorder cancelled. ${item.title} returned to ${position(active.original, item.id)}.`,
      );
      return;
    }

    const delta =
      event.key === "ArrowUp"
        ? -1
        : event.key === "ArrowDown"
          ? 1
          : event.key === "Home"
            ? -Infinity
            : event.key === "End"
              ? Infinity
              : 0;
    if (delta === 0) return;
    event.preventDefault();
    const from = active.ids.indexOf(item.id);
    const to = Math.min(Math.max(from + delta, 0), active.ids.length - 1);
    if (to === from) {
      setAnnouncement(`${item.title} is already at ${position(active.ids, item.id)}.`);
      return;
    }
    const ids = arrayMove(active.ids, from, to);
    setGrab({ ...active, ids });
    setAnnouncement(`${item.title} moved to ${position(ids, item.id)}.`);
  }

  const api: ReorderApi = {
    grab,
    instructionsId,
    reducedMotion,
    registerHandle(id, element) {
      if (element) handles.current.set(id, element);
      else handles.current.delete(id);
    },
    onHandleKeyDown,
  };

  const moduleOrder = grab?.moduleId === null ? grab.ids : undefined;
  const visibleModules = ordered(modules, moduleOrder);
  const addModuleButton = (variant: "primary" | "secondary") => (
    <Button
      type="button"
      variant={variant}
      disabled={addingModule}
      aria-busy={addingModule || undefined}
      onClick={() => void addModule()}
    >
      <PlusIcon className="size-4" aria-hidden="true" />
      Add module
    </Button>
  );

  return (
    <div data-slot="outline-editor" className={cn("flex flex-col gap-4", className)}>
      <p id={instructionsId} className="sr-only">
        Press Space to pick up. Use the arrow keys to move, Space to drop, Escape to cancel.
      </p>
      <div
        aria-live="assertive"
        aria-atomic="true"
        data-slot="outline-editor-announcer"
        className="sr-only"
      >
        {announcement}
      </div>
      {modules.length === 0 ? (
        <EmptyState
          title="No modules yet."
          description="Modules group your lessons. Add one to get started."
          action={addModuleButton("primary")}
        />
      ) : (
        <>
          <SortableList
            moduleId={null}
            items={visibleModules}
            onReorder={onReorder}
            onAnnounce={setAnnouncement}
            label="Modules"
            className="gap-3"
          >
            {visibleModules.map((module) => {
              const lessonOrder = grab?.moduleId === module.id ? grab.ids : undefined;
              const moduleActions: ItemAction[] = [
                {
                  id: "rename",
                  label: "Rename module",
                  icon: <PencilIcon aria-hidden="true" />,
                  onSelect: () => setEditingId(module.id),
                },
                {
                  id: "delete",
                  label: "Delete module",
                  icon: <Trash2Icon aria-hidden="true" />,
                  variant: "danger",
                  onSelect: () => onDeleteModule(module.id),
                },
              ];
              return (
                <SortableRow
                  key={module.id}
                  item={module}
                  moduleId={null}
                  items={visibleModules}
                  api={api}
                  className="border border-border p-2"
                  below={
                    <ModuleLessons
                      module={module}
                      modules={modules}
                      lessons={ordered(module.lessons, lessonOrder)}
                      api={api}
                      onReorder={onReorder}
                      onAnnounce={setAnnouncement}
                      onAddLesson={onAddLesson}
                      callbacks={lessonCallbacks}
                    />
                  }
                >
                  <ModuleTitle
                    module={module}
                    editing={editingId === module.id}
                    onStartEditing={() => setEditingId(module.id)}
                    onCancel={() => setEditingId(null)}
                    onRename={(title) => {
                      setEditingId(null);
                      onRenameModule(module.id, title);
                    }}
                  />
                  <span className="shrink-0 text-xs text-text-muted tabular-nums">
                    {module.lessons.length === 1 ? "1 lesson" : `${module.lessons.length} lessons`}
                  </span>
                  <ItemActionsMenu actions={moduleActions} label={`Actions for ${module.title}`} />
                </SortableRow>
              );
            })}
          </SortableList>
          <div>{addModuleButton("secondary")}</div>
        </>
      )}
    </div>
  );
}

export {
  OutlineEditor,
  type OutlineEditorLesson,
  type OutlineEditorModule,
  type OutlineEditorProps,
};
