"use client";

import { CodeIcon, FileIcon, PlusIcon, UploadIcon, XIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ChangeEvent } from "react";

import { Button } from "../primitives/button";
import { Field } from "../primitives/field";
import { Input } from "../primitives/input";
import { Textarea } from "../primitives/textarea";
import { cn } from "../lib/utils";
import { AgentTaskEditor } from "./agent-task-editor";
import type {
  AgentFileValue,
  AgentJsonCheck,
  AgentLayerFormValue,
  AgentTemplateValue,
} from "./agent-types";
import { formatFileSize } from "./types";

interface AgentLayerFormProps {
  value: AgentLayerFormValue;
  onChange(value: AgentLayerFormValue): void;
  onUploadFile(file: File): Promise<AgentFileValue>;
  checkJson?: AgentJsonCheck;
  errors?: Readonly<Record<string, string>>;
  disabled?: boolean;
  className?: string;
}

const MAX_FILES = 20;

type CodeTemplate = Extract<AgentTemplateValue, { kind: "code" }>;

function FileRow({
  file,
  title,
  onTitle,
  onRemove,
  disabled,
  label,
}: {
  file: AgentFileValue;
  title: string;
  onTitle(title: string): void;
  onRemove(): void;
  disabled: boolean;
  label: string;
}) {
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-end">
      <Field label={`${label} title`} className="min-w-0 flex-1">
        {(control) => (
          <Input
            {...control}
            value={title}
            maxLength={120}
            disabled={disabled}
            onChange={(event) => onTitle(event.target.value)}
          />
        )}
      </Field>
      <div className="flex min-h-10 items-center gap-2 text-sm text-text-muted">
        <FileIcon className="size-4 shrink-0" aria-hidden="true" />
        <span className="max-w-48 truncate text-text">{file.name}</span>
        <span className="tabular-nums">{formatFileSize(file.size)}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={`Remove ${file.name}`}
          onClick={onRemove}
        >
          <XIcon className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

function AgentLayerForm({
  value,
  onChange,
  onUploadFile,
  checkJson,
  errors = {},
  disabled = false,
  className,
}: AgentLayerFormProps) {
  const latest = useRef(value);
  useLayoutEffect(() => {
    latest.current = value;
  });
  const referenceInput = useRef<HTMLInputElement>(null);
  const templateInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function update(patch: Partial<AgentLayerFormValue>) {
    onChange({ ...latest.current, ...patch });
  }

  async function upload(event: ChangeEvent<HTMLInputElement>, target: "references" | "templates") {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const stored = await onUploadFile(file);
      const title = stored.name.replace(/\.[^.]+$/, "");
      if (target === "references") {
        update({ references: [...latest.current.references, { title, file: stored }] });
      } else {
        update({ templates: [...latest.current.templates, { kind: "file", title, file: stored }] });
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : `Couldn't upload ${file.name}.`);
    } finally {
      setUploading(false);
    }
  }

  const busy = disabled || uploading;

  return (
    <div data-slot="agent-layer-form" className={cn("flex flex-col gap-6", className)}>
      <Field
        label="Objective"
        description="What an agent should be able to do after this lesson."
        error={errors.objective}
      >
        {(control) => (
          <Input
            {...control}
            value={value.objective}
            maxLength={500}
            disabled={disabled}
            onChange={(event) => update({ objective: event.target.value })}
          />
        )}
      </Field>
      <Field
        label="Instructions"
        description="Markdown for agents. Raw HTML is not allowed."
        error={errors.instructions}
      >
        {(control) => (
          <Textarea
            {...control}
            value={value.instructions}
            rows={10}
            disabled={disabled}
            className="font-mono"
            onChange={(event) => update({ instructions: event.target.value })}
          />
        )}
      </Field>

      <section aria-labelledby="agent-references-heading" className="flex flex-col gap-2">
        <h3 id="agent-references-heading" className="text-base font-medium text-text">
          References
        </h3>
        {value.references.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {value.references.map((reference, index) => (
              <FileRow
                key={reference.file.key}
                label="Reference"
                file={reference.file}
                title={reference.title}
                disabled={busy}
                onTitle={(title) =>
                  update({
                    references: latest.current.references.map((item, i) =>
                      i === index ? { ...item, title } : item,
                    ),
                  })
                }
                onRemove={() =>
                  update({ references: latest.current.references.filter((_, i) => i !== index) })
                }
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-muted">No reference files yet.</p>
        )}
        <input
          ref={referenceInput}
          type="file"
          hidden
          aria-label="Reference file"
          onChange={(event) => void upload(event, "references")}
        />
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={busy || value.references.length >= MAX_FILES}
            aria-busy={uploading || undefined}
            onClick={() => referenceInput.current?.click()}
          >
            <UploadIcon className="size-4" aria-hidden="true" />
            Upload reference
          </Button>
        </div>
      </section>

      <section aria-labelledby="agent-templates-heading" className="flex flex-col gap-2">
        <h3 id="agent-templates-heading" className="text-base font-medium text-text">
          Templates
        </h3>
        {value.templates.length === 0 ? (
          <p className="text-sm text-text-muted">No templates yet.</p>
        ) : null}
        {value.templates.map((template, index) => {
          const set = (patch: Partial<CodeTemplate>) =>
            update({
              templates: latest.current.templates.map((item, i) =>
                i === index && item.kind === "code" ? { ...item, ...patch } : item,
              ),
            });
          const setTitle = (title: string) =>
            update({
              templates: latest.current.templates.map((item, i) =>
                i === index ? { ...item, title } : item,
              ),
            });
          const remove = () =>
            update({ templates: latest.current.templates.filter((_, i) => i !== index) });
          if (template.kind === "file") {
            return (
              <ul key={template.file.key}>
                <FileRow
                  label="Template"
                  file={template.file}
                  title={template.title}
                  disabled={busy}
                  onTitle={setTitle}
                  onRemove={remove}
                />
              </ul>
            );
          }
          return (
            <fieldset
              key={index}
              className="flex flex-col gap-4 rounded-md border border-border bg-surface p-3 md:p-4"
            >
              <legend className="flex items-center gap-2 px-1 text-sm font-medium text-text">
                <CodeIcon className="size-4" aria-hidden="true" />
                Code template {index + 1}
              </legend>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Title" error={errors[`templates.${index}.title`]}>
                  {(control) => (
                    <Input
                      {...control}
                      value={template.title}
                      disabled={disabled}
                      onChange={(event) => set({ title: event.target.value })}
                    />
                  )}
                </Field>
                <Field label="File name" error={errors[`templates.${index}.name`]}>
                  {(control) => (
                    <Input
                      {...control}
                      value={template.name}
                      disabled={disabled}
                      onChange={(event) => set({ name: event.target.value })}
                    />
                  )}
                </Field>
                <Field label="Language" error={errors[`templates.${index}.language`]}>
                  {(control) => (
                    <Input
                      {...control}
                      value={template.language}
                      disabled={disabled}
                      onChange={(event) => set({ language: event.target.value })}
                    />
                  )}
                </Field>
              </div>
              <Field label="Code" error={errors[`templates.${index}.content`]}>
                {(control) => (
                  <Textarea
                    {...control}
                    value={template.content}
                    rows={8}
                    spellCheck={false}
                    disabled={disabled}
                    className="font-mono text-sm"
                    onChange={(event) => set({ content: event.target.value })}
                  />
                )}
              </Field>
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={remove}
                >
                  <XIcon className="size-4" aria-hidden="true" />
                  Remove code template {index + 1}
                </Button>
              </div>
            </fieldset>
          );
        })}
        <input
          ref={templateInput}
          type="file"
          hidden
          aria-label="Template file"
          onChange={(event) => void upload(event, "templates")}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy || value.templates.length >= MAX_FILES}
            onClick={() =>
              update({
                templates: [
                  ...latest.current.templates,
                  {
                    kind: "code",
                    title: "",
                    name: `template-${latest.current.templates.length + 1}.txt`,
                    language: "text",
                    content: "",
                  },
                ],
              })
            }
          >
            <PlusIcon className="size-4" aria-hidden="true" />
            Add code template
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy || value.templates.length >= MAX_FILES}
            onClick={() => templateInput.current?.click()}
          >
            <UploadIcon className="size-4" aria-hidden="true" />
            Upload template file
          </Button>
        </div>
        <p aria-live="polite" className={cn("text-sm text-danger", !uploadError && "sr-only")}>
          {uploadError}
        </p>
      </section>

      <AgentTaskEditor
        tasks={value.tasks}
        evaluations={value.evaluations}
        check={checkJson}
        errors={errors}
        disabled={disabled}
        onChange={(next) => update(next)}
      />
    </div>
  );
}

export function agentLayerPreview(value: AgentLayerFormValue, lessonTitle: string): string {
  const lines = [`# ${lessonTitle}`, "", `Objective: ${value.objective.trim()}`, ""];
  if (value.instructions.trim()) lines.push("## Instructions", "", value.instructions.trim(), "");
  if (value.references.length) {
    lines.push(
      "## References",
      "",
      ...value.references.map((r) => `- ${r.title} (${r.file.name})`),
      "",
    );
  }
  if (value.templates.length) {
    lines.push(
      "## Templates",
      "",
      ...value.templates.map(
        (t) => `- ${t.title || "Untitled"} (${t.kind === "file" ? t.file.name : t.name})`,
      ),
      "",
    );
  }
  if (value.tasks.length) {
    lines.push("## Tasks", "", ...value.tasks.map((t) => `- ${t.id}: ${t.title}`), "");
  }
  if (value.evaluations.length) {
    lines.push(
      "## Evaluations",
      "",
      ...value.evaluations.map((e) => `- ${e.taskId}: ${e.kind}`),
      "",
    );
  }
  return lines.join("\n").trimEnd();
}

export { AgentLayerForm, type AgentLayerFormProps };
