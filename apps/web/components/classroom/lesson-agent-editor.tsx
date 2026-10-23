"use client";

import {
  AgentLayerForm,
  agentLayerPreview,
  Alert,
  AlertDescription,
  Button,
  toast,
  type AgentLayerFormValue,
} from "@cohory/ui";
import { WandSparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  checkAgentJsonAction,
  draftLessonAgentLayerAction,
  saveLessonAgentLayerAction,
} from "../../lib/courses/agent-actions";
import { uploadAgentFile } from "./client-helpers";
import { saveFailedMessage } from "./course-form";

export interface LessonAgentEditorProps {
  slug: string;
  courseId: string;
  lesson: { id: string; title: string };
  value: AgentLayerFormValue;
  onChange(value: AgentLayerFormValue): void;
  onSaved(value: AgentLayerFormValue): void;
  saved: boolean;
  onClose(): void;
}

const checkJson = (kind: "schema" | "spec", text: string) => checkAgentJsonAction({ kind, text });

export function LessonAgentEditor({
  slug,
  courseId,
  lesson,
  value,
  onChange,
  onSaved,
  saved,
  onClose,
}: LessonAgentEditorProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function draft() {
    setPending(true);
    setError(null);
    try {
      const result = await draftLessonAgentLayerAction({ slug, lessonId: lesson.id });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onChange({ ...result.data, references: value.references });
      setFieldErrors({});
      toast("Draft ready. Review it, then save.");
    } catch {
      setError("We couldn't make a draft. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  async function save() {
    if (value.objective.trim() === "") {
      setFieldErrors({ objective: "Write what an agent should help a member do." });
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await saveLessonAgentLayerAction({ slug, lessonId: lesson.id, layer: value });
      if (!result.ok) {
        setError(result.message);
        setFieldErrors(result.fieldErrors);
        return;
      }
      setFieldErrors({});
      onSaved(value);
      toast("Agent material saved. Publish a version from the course page to share it.");
      router.refresh();
    } catch {
      setError(saveFailedMessage);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-hover p-3 text-sm text-text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          {saved
            ? "Agents see this after you publish an agent version of the course."
            : "Start from the lesson: the draft takes headings, numbered exercises, and code blocks."}
        </p>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => void draft()}>
          <WandSparklesIcon className="size-4" aria-hidden="true" />
          Draft from lesson
        </Button>
      </div>
      {error ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <AgentLayerForm
        value={value}
        onChange={onChange}
        onUploadFile={(file) => uploadAgentFile(slug, courseId, file)}
        checkJson={checkJson}
        errors={fieldErrors}
        disabled={pending}
      />
      <details className="rounded-md border border-border bg-surface p-3">
        <summary className="min-h-11 cursor-pointer content-center text-sm font-medium text-text">
          Preview what agents read
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-sm bg-surface-hover p-3 text-xs whitespace-pre-wrap text-text">
          {agentLayerPreview(value, lesson.title)}
        </pre>
      </details>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
          Close
        </Button>
        <Button
          type="button"
          disabled={pending}
          aria-busy={pending || undefined}
          onClick={() => void save()}
        >
          {pending ? "Saving…" : "Save agent material"}
        </Button>
      </div>
    </div>
  );
}
