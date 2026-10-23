"use client";

import {
  Button,
  CourseOutline,
  LessonPlayer,
  PublishToggle,
  toast,
  type AgentLayerFormValue,
  type CourseOutlineModule,
  type LessonAttachment,
  type LessonPlayerFinish,
} from "@cohory/ui";
import { ArrowLeftIcon, PencilIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  recordLessonViewAction,
  setLessonCompleteAction,
  setLessonPublishedAction,
} from "../../lib/courses/actions";
import { courseFinished, lessonProgress } from "../../lib/courses/views";
import { lessonDraftKey } from "./lesson-draft-key";
import { MemberPreviewBanner, MemberPreviewButton } from "./member-preview";

const LessonEditor = dynamic(() => import("./lesson-editor").then((mod) => mod.LessonEditor), {
  loading: () => <p className="text-sm text-text-muted">Loading the editor…</p>,
});

export interface LessonViewProps {
  slug: string;
  course: { id: string; slug: string; title: string; href: string };
  lesson: {
    id: string;
    slug: string;
    title: string;
    status: "draft" | "published";
    bodyHtml: string;
    bodyMarkdown?: string;
    videoUrl: string | null;
    attachments: LessonAttachment[];
  };
  completed: boolean;
  previousHref: string | null;
  nextHref: string | null;
  outline: CourseOutlineModule[];
  manager: boolean;
  previewing: boolean;
  draftHidden: boolean;
  tracksProgress: boolean;
  initialEditing: boolean;
  agentLayer: { initial: AgentLayerFormValue; saved: boolean } | null;
  finish: LessonPlayerFinish | null;
}

function subscribeToStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function storedDraftExists(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

export function LessonView(props: LessonViewProps) {
  const { slug, course, lesson, manager } = props;
  const [editing, setEditing] = useState(manager && props.initialEditing);
  const hasDraft = useSyncExternalStore(
    subscribeToStorage,
    () => manager && storedDraftExists(lessonDraftKey(lesson.id)),
    () => false,
  );

  return (
    <div className="flex flex-col gap-4">
      {props.previewing ? <MemberPreviewBanner slug={slug} /> : null}
      {props.draftHidden ? (
        <p className="rounded-md bg-warning-muted p-3 text-sm text-text">
          Members can&apos;t see this lesson yet because it is a draft.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={course.href}
          className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-text-muted outline-none hover:text-text focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {course.title}
        </Link>
        {manager && !editing ? (
          <div className="flex flex-wrap items-center gap-3">
            <LessonPublishToggle slug={slug} courseSlug={course.slug} lesson={lesson} />
            {hasDraft ? (
              <span className="text-sm text-text-muted">Unsaved changes on this device</span>
            ) : null}
            <MemberPreviewButton slug={slug} />
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
              <PencilIcon className="size-4" aria-hidden="true" />
              {hasDraft ? "Resume editing" : "Edit lesson"}
            </Button>
          </div>
        ) : null}
      </div>
      {editing ? (
        <LessonEditor
          slug={slug}
          course={course}
          lesson={lesson}
          agentLayer={props.agentLayer}
          onDone={() => setEditing(false)}
        />
      ) : (
        <LessonPlayerView {...props} />
      )}
    </div>
  );
}

function LessonPublishToggle({
  slug,
  courseSlug,
  lesson,
}: {
  slug: string;
  courseSlug: string;
  lesson: LessonViewProps["lesson"];
}) {
  const router = useRouter();

  async function change(published: boolean) {
    const result = await setLessonPublishedAction({
      slug,
      courseSlug,
      lessonId: lesson.id,
      published,
    });
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast(published ? "Lesson published." : "Lesson moved to drafts.");
    router.refresh();
  }

  return (
    <PublishToggle
      status={lesson.status}
      label="Publish lesson"
      onPublish={() => change(true)}
      onUnpublish={() => change(false)}
    />
  );
}

function LessonPlayerView({
  slug,
  course,
  lesson,
  completed: initialCompleted,
  previousHref,
  nextHref,
  outline,
  tracksProgress,
  finish,
}: LessonViewProps) {
  const router = useRouter();
  const [completed, setCompleted] = useState(initialCompleted);

  useEffect(() => {
    if (!tracksProgress) return;
    void recordLessonViewAction({ slug, lessonId: lesson.id }).catch(() => undefined);
  }, [slug, lesson.id, tracksProgress]);

  async function toggleComplete() {
    if (!tracksProgress) {
      toast("Join this community to track your progress.");
      return;
    }
    const next = !completed;
    setCompleted(next);
    const result = await setLessonCompleteAction({
      slug,
      courseSlug: course.slug,
      lessonId: lesson.id,
      completed: next,
    });
    if (!result.ok) {
      setCompleted(!next);
      toast.error(result.message);
      return;
    }
    router.refresh();
  }

  const modules = outline.map((module) => ({
    ...module,
    lessons: module.lessons.map((row) => (row.id === lesson.id ? { ...row, completed } : row)),
  }));

  return (
    <LessonPlayer
      lesson={{
        title: lesson.title,
        videoUrl: lesson.videoUrl,
        bodyHtml: lesson.bodyHtml,
        attachments: lesson.attachments,
      }}
      completed={completed}
      onToggleComplete={toggleComplete}
      previousHref={previousHref}
      nextHref={nextHref}
      onNavigate={(href) => router.push(href)}
      sidebar={<CourseOutline modules={modules} currentLessonId={lesson.id} />}
      progress={lessonProgress(modules, lesson.id, tracksProgress) ?? undefined}
      finish={finish && courseFinished(modules) ? finish : undefined}
    />
  );
}
