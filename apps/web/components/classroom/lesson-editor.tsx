"use client";

import {
  Badge,
  Button,
  LessonForm,
  lessonVideoInvalid,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  type AgentLayerFormValue,
  type LessonFormErrors,
  type LessonFormValue,
} from "@cohory/ui";
import { findBlockedImages, renderLessonHtml, withoutLeadingTitle } from "@cohory/courses/markdown";
import { draftSavedTime, useDraftAutosave } from "@cohory/ui/lib/use-draft-autosave";
import { useFocusFirstError } from "@cohory/ui/lib/use-focus-first-error";
import { useUnsavedChanges } from "@cohory/ui/lib/use-unsaved-changes";
import { useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { z } from "zod";

import { updateLessonAction } from "../../lib/courses/actions";
import { lessonHref } from "../../lib/courses/hrefs";
import { toAttachmentRefs } from "../../lib/courses/views";
import { uploadLessonAttachment, uploadLessonImage } from "./client-helpers";
import { saveFailedMessage } from "./course-form";
import { LessonAgentEditor } from "./lesson-agent-editor";
import { lessonDraftKey } from "./lesson-draft-key";
import type { LessonViewProps } from "./lesson-view";

export interface LessonEditorProps {
  slug: string;
  course: LessonViewProps["course"];
  lesson: LessonViewProps["lesson"];
  agentLayer: LessonViewProps["agentLayer"];
  onDone(): void;
}

const draftSchema = z.object({
  title: z.string(),
  bodyMarkdown: z.string(),
  videoUrl: z.string(),
  attachments: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string(),
      href: z.string(),
      size: z.number(),
      contentType: z.string(),
    }),
  ),
});

function parseDraft(raw: unknown): LessonFormValue | null {
  const parsed = draftSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const lessonFields = ["title", "bodyMarkdown", "videoUrl", "attachments"] as const;

type Failure =
  | { kind: "none" }
  | { kind: "fields"; errors: LessonFormErrors }
  | { kind: "form"; message: string }
  | { kind: "offline" };

function toFailure(message: string, fieldErrors: Record<string, string> | undefined): Failure {
  const errors: LessonFormErrors = {};
  for (const field of lessonFields) {
    const error = fieldErrors?.[field];
    if (error) errors[field] = error;
  }
  return Object.keys(errors).length > 0 ? { kind: "fields", errors } : { kind: "form", message };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function LessonEditor({ slug, course, lesson, agentLayer, onDone }: LessonEditorProps) {
  const router = useRouter();
  const [saved] = useState<LessonFormValue>(() => ({
    title: lesson.title,
    bodyMarkdown: lesson.bodyMarkdown ?? "",
    videoUrl: lesson.videoUrl ?? "",
    attachments: lesson.attachments,
  }));
  const [value, setValue] = useState(saved);
  const [agentSaved, setAgentSaved] = useState(agentLayer?.initial ?? null);
  const [agentValue, setAgentValue] = useState(agentLayer?.initial ?? null);
  const [failure, setFailure] = useState<Failure>({ kind: "none" });
  const [pending, setPending] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const lessonDirty = !sameJson(value, saved);
  const dirty = lessonDirty || !sameJson(agentValue, agentSaved);
  const draft = useDraftAutosave(lessonDraftKey(lesson.id), value, {
    dirty: lessonDirty,
    parse: parseDraft,
  });
  useUnsavedChanges(dirty && !pending);
  const fieldErrors = failure.kind === "fields" ? failure.errors : undefined;
  const formRef = useFocusFirstError<HTMLFormElement>(fieldErrors);

  const draftLesson = lesson.status === "draft";
  const videoInvalid = lessonVideoInvalid(value.videoUrl);
  const deferredBody = useDeferredValue(value.bodyMarkdown);
  const blockedImages = useMemo(() => findBlockedImages(deferredBody), [deferredBody]);

  async function save(publish: boolean) {
    if (pending || videoInvalid) return;
    if (value.title.trim() === "") {
      setFailure({ kind: "fields", errors: { title: "Give your lesson a title." } });
      return;
    }
    setPending(true);
    setFailure({ kind: "none" });
    try {
      const result = await updateLessonAction({
        slug,
        courseSlug: course.slug,
        lessonId: lesson.id,
        title: value.title,
        bodyMarkdown: value.bodyMarkdown,
        videoUrl: value.videoUrl,
        attachments: toAttachmentRefs(value.attachments),
        publish,
      });
      if (!result.ok) {
        setFailure(toFailure(result.message, result.fieldErrors));
        return;
      }
      draft.clear();
      toast(publish ? "Lesson saved and published." : "Lesson saved.");
      onDone();
      router.replace(lessonHref(slug, course.slug, result.data.lessonSlug));
      router.refresh();
    } catch {
      setFailure({ kind: "offline" });
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(false);
  }

  function submitWithShortcut(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  }

  function requestClose() {
    if (pending) return;
    if (dirty) {
      setConfirmingDiscard(true);
      return;
    }
    onDone();
  }

  function discard() {
    draft.clear();
    onDone();
  }

  function restoreDraft(restored: LessonFormValue) {
    draft.clear();
    setValue(restored);
  }

  const closeControls = confirmingDiscard ? (
    <div
      role="group"
      aria-label="Discard your changes?"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-warning-muted p-3 text-sm"
    >
      <span className="text-text">Discard your changes?</span>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => setConfirmingDiscard(false)}>
          Keep editing
        </Button>
        <Button type="button" variant="ghost" className="text-danger" onClick={discard}>
          Discard changes
        </Button>
      </div>
    </div>
  ) : null;

  const lessonForm = (
    <form
      ref={formRef}
      noValidate
      aria-label="Lesson"
      onSubmit={submit}
      onKeyDown={submitWithShortcut}
      className="flex flex-col gap-6"
    >
      {draft.restore ? (
        <div
          role="group"
          aria-label="Unsaved changes on this device"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-hover p-3 text-sm"
        >
          <span className="text-text">
            You have unsaved changes from {draftSavedTime(draft.restore.savedAt)}.
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => draft.restore && restoreDraft(draft.restore.value)}
            >
              Restore changes
            </Button>
            <Button type="button" variant="ghost" onClick={draft.clear}>
              Discard
            </Button>
          </div>
        </div>
      ) : null}
      <LessonForm
        value={value}
        onChange={setValue}
        onUploadAttachment={(file) => uploadLessonAttachment(slug, course.id, file)}
        onUploadImage={(file) => uploadLessonImage(slug, file)}
        renderPreview={(markdown) => withoutLeadingTitle(renderLessonHtml(markdown), value.title)}
        blockedImages={blockedImages}
        errors={fieldErrors}
        disabled={pending}
      />
      {failure.kind === "form" || failure.kind === "offline" ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          <p>{failure.kind === "offline" ? saveFailedMessage : failure.message}</p>
          {failure.kind === "offline" ? (
            <Button type="submit" variant="secondary" size="sm">
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
      {closeControls}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {dirty ? <span className="mr-auto text-sm text-text-muted">Unsaved changes</span> : null}
        <Button type="button" variant="secondary" disabled={pending} onClick={requestClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant={draftLesson ? "secondary" : "primary"}
          disabled={pending || videoInvalid}
          aria-busy={pending || undefined}
        >
          {pending ? "Saving…" : draftLesson ? "Save draft" : "Save"}
        </Button>
        {draftLesson ? (
          <Button type="button" disabled={pending || videoInvalid} onClick={() => void save(true)}>
            Publish
          </Button>
        ) : null}
      </div>
    </form>
  );

  return (
    <section
      aria-labelledby="lesson-editor-heading"
      className="flex flex-col gap-6 rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) p-4 md:p-6"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="lesson-editor-heading" className="font-heading text-2xl text-text">
          Edit lesson
        </h1>
        <Badge variant={draftLesson ? "warning" : "success"}>
          {draftLesson ? "Draft" : "Published"}
        </Badge>
      </div>
      {agentLayer && agentValue ? (
        <Tabs defaultValue="lesson">
          <TabsList aria-label="Lesson editor">
            <TabsTrigger value="lesson">Lesson</TabsTrigger>
            <TabsTrigger value="agents">For agents</TabsTrigger>
          </TabsList>
          <TabsContent value="lesson">{lessonForm}</TabsContent>
          <TabsContent value="agents" className="flex flex-col gap-6">
            <LessonAgentEditor
              slug={slug}
              courseId={course.id}
              lesson={{ id: lesson.id, title: lesson.title }}
              value={agentValue}
              onChange={setAgentValue}
              onSaved={(layer: AgentLayerFormValue) => setAgentSaved(layer)}
              saved={agentLayer.saved}
              onClose={requestClose}
            />
            {closeControls}
          </TabsContent>
        </Tabs>
      ) : (
        lessonForm
      )}
    </section>
  );
}
