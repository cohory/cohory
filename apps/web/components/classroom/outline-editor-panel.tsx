"use client";

import { OutlineEditor, toast, type OutlineEditorModule } from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  createLessonAction,
  createModuleAction,
  deleteLessonAction,
  deleteModuleAction,
  duplicateLessonAction,
  moveLessonAction,
  renameModuleAction,
  reorderLessonsAction,
  reorderModulesAction,
  setLessonPublishedAction,
} from "../../lib/courses/actions";
import type { ActionResult } from "../../lib/posts/errors";
import { ConfirmDialog } from "../feed/confirm-dialog";

type Pending =
  | { kind: "module"; id: string; title: string; lessonCount: number }
  | { kind: "lesson"; id: string; title: string };

function reorder<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

function lessonsWord(count: number): string {
  return count === 1 ? "1 lesson" : `${count} lessons`;
}

function deleteCopy(pending: Pending): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  if (pending.kind === "module") {
    return {
      title: `Delete "${pending.title}"?`,
      description:
        pending.lessonCount === 0
          ? "The module will be removed for all members."
          : `The module and its ${lessonsWord(pending.lessonCount)} will be removed for all members. Member progress for these lessons is also deleted.`,
      confirmLabel: "Delete module",
    };
  }
  return {
    title: `Delete "${pending.title}"?`,
    description:
      "The lesson will be removed for all members. Member progress for this lesson is also deleted.",
    confirmLabel: "Delete lesson",
  };
}

export function OutlineEditorPanel({
  slug,
  courseSlug,
  modules: initial,
}: {
  slug: string;
  courseSlug: string;
  modules: OutlineEditorModule[];
}) {
  const router = useRouter();
  const [modules, setModules] = useState(initial);
  const [synced, setSynced] = useState(initial);
  const [pendingDelete, setPendingDelete] = useState<Pending | null>(null);

  if (synced !== initial) {
    setSynced(initial);
    setModules(initial);
  }

  async function settle<T>(result: Promise<ActionResult<T>>): Promise<ActionResult<T>> {
    const outcome = await result;
    if (!outcome.ok) {
      toast.error(outcome.message);
      setModules(initial);
    }
    router.refresh();
    return outcome;
  }

  function onReorder(moduleId: string | null, ids: string[]) {
    if (moduleId === null) {
      setModules((current) => reorder(current, ids));
      void settle(reorderModulesAction({ slug, courseSlug, ids }));
      return;
    }
    setModules((current) =>
      current.map((module) =>
        module.id === moduleId ? { ...module, lessons: reorder(module.lessons, ids) } : module,
      ),
    );
    void settle(reorderLessonsAction({ slug, courseSlug, moduleId, ids }));
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    await settle(
      pendingDelete.kind === "module"
        ? deleteModuleAction({ slug, courseSlug, moduleId: pendingDelete.id })
        : deleteLessonAction({ slug, courseSlug, lessonId: pendingDelete.id }),
    );
    setPendingDelete(null);
  }

  const lessons = modules.flatMap((module) => module.lessons);
  const lessonById = (id: string) => lessons.find((lesson) => lesson.id === id);
  const copy = pendingDelete ? deleteCopy(pendingDelete) : null;

  return (
    <section aria-label="Edit outline" className="flex flex-col gap-3">
      <OutlineEditor
        modules={modules}
        onAddModule={async () => {
          const created = await settle(
            createModuleAction({ slug, courseSlug, title: `Module ${modules.length + 1}` }),
          );
          return created.ok ? created.data.id : null;
        }}
        onRenameModule={(moduleId, title) => {
          setModules((current) =>
            current.map((module) => (module.id === moduleId ? { ...module, title } : module)),
          );
          void settle(renameModuleAction({ slug, courseSlug, moduleId, title }));
        }}
        onDeleteModule={(moduleId) => {
          const target = modules.find((candidate) => candidate.id === moduleId);
          if (target) {
            setPendingDelete({
              kind: "module",
              id: target.id,
              title: target.title,
              lessonCount: target.lessons.length,
            });
          }
        }}
        onAddLesson={async (moduleId, title) => {
          const created = await settle(createLessonAction({ slug, courseSlug, moduleId, title }));
          return created.ok;
        }}
        onEditLesson={(lessonId) => {
          const href = lessonById(lessonId)?.href;
          if (href) router.push(href);
        }}
        onDuplicateLesson={(lessonId) => {
          void settle(duplicateLessonAction({ slug, courseSlug, lessonId })).then((result) => {
            if (result.ok) toast("Lesson duplicated as a draft.");
          });
        }}
        onSetLessonPublished={(lessonId, published) => {
          setModules((current) =>
            current.map((module) => ({
              ...module,
              lessons: module.lessons.map((lesson) =>
                lesson.id === lessonId
                  ? { ...lesson, status: published ? "published" : "draft" }
                  : lesson,
              ),
            })),
          );
          void settle(setLessonPublishedAction({ slug, courseSlug, lessonId, published }));
        }}
        onMoveLesson={(lessonId, moduleId) => {
          const lesson = lessonById(lessonId);
          if (!lesson) return;
          setModules((current) =>
            current.map((module) => ({
              ...module,
              lessons:
                module.id === moduleId
                  ? [...module.lessons.filter((row) => row.id !== lessonId), lesson]
                  : module.lessons.filter((row) => row.id !== lessonId),
            })),
          );
          void settle(moveLessonAction({ slug, courseSlug, lessonId, moduleId }));
        }}
        onDeleteLesson={(lessonId) =>
          setPendingDelete({
            kind: "lesson",
            id: lessonId,
            title: lessonById(lessonId)?.title ?? "",
          })
        }
        onReorder={onReorder}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => (open ? undefined : setPendingDelete(null))}
        title={copy?.title ?? ""}
        description={copy?.description ?? ""}
        confirmLabel={copy?.confirmLabel ?? "Delete"}
        onConfirm={confirmDelete}
      />
    </section>
  );
}
