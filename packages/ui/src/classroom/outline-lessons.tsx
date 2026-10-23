"use client";

import {
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  FolderInputIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { ItemActionsMenu, type ItemAction } from "../community/item-actions";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { SortableList, SortableRow, type ReorderApi } from "./outline-sortable";
import type { LessonStatus } from "./types";

export interface OutlineEditorLesson {
  id: string;
  title: string;
  status: LessonStatus;
  href?: string;
}

export interface OutlineEditorModule {
  id: string;
  title: string;
  lessons: OutlineEditorLesson[];
}

export interface LessonCallbacks {
  onEditLesson?(lessonId: string): void;
  onDuplicateLesson?(lessonId: string): void;
  onSetLessonPublished?(lessonId: string, published: boolean): void;
  onMoveLesson?(lessonId: string, moduleId: string): void;
  onDeleteLesson?(lessonId: string): void;
}

function lessonActions(
  lesson: OutlineEditorLesson,
  module: OutlineEditorModule,
  modules: OutlineEditorModule[],
  callbacks: LessonCallbacks,
): ItemAction[] {
  const { onEditLesson, onDuplicateLesson, onSetLessonPublished, onMoveLesson, onDeleteLesson } =
    callbacks;
  const published = lesson.status === "published";
  return [
    ...(onEditLesson
      ? [
          {
            id: "edit",
            label: "Edit lesson",
            icon: <PencilIcon aria-hidden="true" />,
            onSelect: () => onEditLesson(lesson.id),
          },
        ]
      : []),
    ...(onDuplicateLesson
      ? [
          {
            id: "duplicate",
            label: "Duplicate as draft",
            icon: <CopyIcon aria-hidden="true" />,
            onSelect: () => onDuplicateLesson(lesson.id),
          },
        ]
      : []),
    ...(onSetLessonPublished
      ? [
          {
            id: "publish",
            label: published ? "Move to drafts" : "Publish lesson",
            icon: published ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />,
            onSelect: () => onSetLessonPublished(lesson.id, !published),
          },
        ]
      : []),
    ...(onMoveLesson
      ? modules
          .filter((target) => target.id !== module.id)
          .map((target) => ({
            id: `move-${target.id}`,
            label: `Move to ${target.title}`,
            icon: <FolderInputIcon aria-hidden="true" />,
            onSelect: () => onMoveLesson(lesson.id, target.id),
          }))
      : []),
    ...(onDeleteLesson
      ? [
          {
            id: "delete",
            label: "Delete lesson",
            icon: <Trash2Icon aria-hidden="true" />,
            variant: "danger" as const,
            onSelect: () => onDeleteLesson(lesson.id),
          },
        ]
      : []),
  ];
}

function AddLessonRow({
  module,
  onAddLesson,
}: {
  module: OutlineEditorModule;
  onAddLesson(moduleId: string, title: string): Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    setTitle("");
    requestAnimationFrame(() => opener.current?.focus());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      if (await onAddLesson(module.id, trimmed)) setTitle("");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <div>
        <Button
          ref={opener}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Add lesson to ${module.title}`}
          onClick={() => setOpen(true)}
        >
          <PlusIcon className="size-4" aria-hidden="true" />
          Add lesson
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex items-center gap-2 px-1">
      <Input
        autoFocus
        value={title}
        aria-label={`New lesson title in ${module.title}`}
        aria-busy={pending || undefined}
        placeholder="Lesson title, then Enter"
        maxLength={120}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
        className="h-9"
      />
      <Button type="submit" size="sm" disabled={pending || title.trim() === ""}>
        Add
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={close}>
        Done
      </Button>
    </form>
  );
}

export function ModuleLessons({
  module,
  modules,
  lessons,
  api,
  onReorder,
  onAnnounce,
  onAddLesson,
  callbacks,
}: {
  module: OutlineEditorModule;
  modules: OutlineEditorModule[];
  lessons: OutlineEditorLesson[];
  api: ReorderApi;
  onReorder(moduleId: string | null, orderedIds: string[]): void;
  onAnnounce(message: string): void;
  onAddLesson(moduleId: string, title: string): Promise<boolean>;
  callbacks: LessonCallbacks;
}) {
  return (
    <div className="flex flex-col gap-1 pt-1 pl-6">
      {lessons.length > 0 ? (
        <SortableList
          moduleId={module.id}
          items={lessons}
          onReorder={onReorder}
          onAnnounce={onAnnounce}
          label={`Lessons in ${module.title}`}
        >
          {lessons.map((lesson) => (
            <SortableRow
              key={lesson.id}
              item={lesson}
              moduleId={module.id}
              items={lessons}
              api={api}
              className="hover:bg-surface-hover"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-text">
                {lesson.href ? (
                  <a
                    href={lesson.href}
                    className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {lesson.title}
                  </a>
                ) : (
                  lesson.title
                )}
              </span>
              {lesson.status === "draft" ? <Badge variant="warning">Draft</Badge> : null}
              <ItemActionsMenu
                label={`Actions for ${lesson.title}`}
                actions={lessonActions(lesson, module, modules, callbacks)}
              />
            </SortableRow>
          ))}
        </SortableList>
      ) : (
        <p className="px-3 py-2 text-sm text-text-muted">No lessons in this module yet.</p>
      )}
      <AddLessonRow module={module} onAddLesson={onAddLesson} />
    </div>
  );
}
