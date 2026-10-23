"use client";

import { PaperclipIcon, XIcon } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type ChangeEvent } from "react";

import { Button } from "../primitives/button";
import { Field } from "../primitives/field";
import { Input } from "../primitives/input";
import { cn } from "../lib/utils";
import { attachmentIcon } from "./lesson-attachments";
import { LessonBodyField } from "./lesson-body-field";
import { LessonVideo } from "./lesson-video";
import { formatFileSize, resolveLessonVideo, type LessonAttachment } from "./types";

interface LessonFormValue {
  title: string;
  bodyMarkdown: string;
  videoUrl: string;
  attachments: LessonAttachment[];
}

type LessonFormErrors = Partial<Record<keyof LessonFormValue, string>>;

interface LessonFormProps {
  value: LessonFormValue;
  onChange(value: LessonFormValue): void;
  onUploadAttachment(file: File): Promise<LessonAttachment>;
  errors?: LessonFormErrors;
  maxAttachments?: number;
  maxAttachmentBytes?: number;
  maxTitleLength?: number;
  maxBodyLength?: number;
  onUploadImage?(file: File): Promise<{ src: string }>;
  renderPreview?(markdown: string): string;
  blockedImages?: readonly string[];
  disabled?: boolean;
  locale?: string;
  className?: string;
}

const MB = 1024 * 1024;
const lessonFormLimits = { title: 120, body: 100_000 } as const;
const VIDEO_HINT = "Paste a YouTube, Vimeo, Loom, or Wistia link.";

function lessonVideoInvalid(videoUrl: string): boolean {
  const trimmed = videoUrl.trim();
  return trimmed !== "" && resolveLessonVideo(trimmed) === null;
}

function LessonForm({
  value,
  onChange,
  onUploadAttachment,
  errors = {},
  maxAttachments = 10,
  maxAttachmentBytes = 25 * MB,
  maxTitleLength = lessonFormLimits.title,
  maxBodyLength = lessonFormLimits.body,
  onUploadImage,
  renderPreview,
  blockedImages,
  disabled = false,
  locale,
  className,
}: LessonFormProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const latest = useRef(value);
  useLayoutEffect(() => {
    latest.current = value;
  });
  const attachmentsId = useId();
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const trimmedVideo = value.videoUrl.trim();
  const videoError =
    errors.videoUrl ??
    (lessonVideoInvalid(trimmedVideo) ? `This link isn't supported. ${VIDEO_HINT}` : undefined);
  const attachmentsError = uploadError ?? errors.attachments;
  const remaining = maxAttachments - value.attachments.length;
  const titleLeft = maxTitleLength - value.title.length;

  function update(patch: Partial<LessonFormValue>) {
    onChange({ ...latest.current, ...patch });
  }

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setUploadError(null);
    if (files.length > remaining) {
      setUploadError(`You can attach up to ${maxAttachments} files.`);
      return;
    }
    const tooLarge = files.find((file) => file.size > maxAttachmentBytes);
    if (tooLarge) {
      setUploadError(
        `${tooLarge.name} is larger than ${formatFileSize(maxAttachmentBytes, locale)}.`,
      );
      return;
    }
    setUploading((count) => count + files.length);
    for (const file of files) {
      try {
        const attachment = await onUploadAttachment(file);
        update({ attachments: [...latest.current.attachments, attachment] });
      } catch {
        setUploadError(`Couldn't upload ${file.name}. Try again.`);
      } finally {
        setUploading((count) => count - 1);
      }
    }
  }

  function removeAttachment(index: number) {
    update({ attachments: latest.current.attachments.filter((_, i) => i !== index) });
  }

  return (
    <div data-slot="lesson-form" className={cn("flex flex-col gap-6", className)}>
      <Field
        label="Title"
        description={titleLeft <= 20 ? `${titleLeft} characters left` : undefined}
        error={errors.title}
      >
        {(control) => (
          <Input
            {...control}
            name="title"
            value={value.title}
            maxLength={maxTitleLength}
            required
            disabled={disabled}
            onChange={(event) => update({ title: event.target.value })}
          />
        )}
      </Field>
      <Field
        label="Video link"
        description={videoError ? undefined : VIDEO_HINT}
        error={videoError}
      >
        {(control) => (
          <Input
            {...control}
            type="url"
            inputMode="url"
            placeholder="https://"
            value={value.videoUrl}
            disabled={disabled}
            onChange={(event) => update({ videoUrl: event.target.value })}
          />
        )}
      </Field>
      {trimmedVideo && !videoError ? (
        <LessonVideo
          url={trimmedVideo}
          title={value.title.trim() || "Lesson"}
          className="max-w-md"
        />
      ) : null}
      <LessonBodyField
        value={value.bodyMarkdown}
        onChange={(bodyMarkdown) => update({ bodyMarkdown })}
        error={errors.bodyMarkdown}
        maxLength={maxBodyLength}
        disabled={disabled}
        onUploadImage={onUploadImage}
        renderPreview={renderPreview}
        blockedImages={blockedImages}
        locale={locale}
      />
      <section aria-labelledby={`${attachmentsId}-label`} className="flex flex-col gap-2">
        <h3 id={`${attachmentsId}-label`} className="text-sm font-medium text-text">
          Attachments
        </h3>
        {value.attachments.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
            {value.attachments.map((attachment, index) => {
              const Icon = attachmentIcon(attachment.contentType);
              return (
                <li
                  key={attachment.id ?? `${attachment.name}-${index}`}
                  className="flex min-h-11 items-center gap-3 py-1 pr-1 pl-3 text-sm"
                >
                  <Icon className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-text">{attachment.name}</span>
                  <span className="shrink-0 text-xs text-text-muted tabular-nums">
                    {formatFileSize(attachment.size, locale)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    aria-label={`Remove ${attachment.name}`}
                    onClick={() => removeAttachment(index)}
                  >
                    <XIcon className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          aria-label="Attachment files"
          onChange={(event) => void addFiles(event)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || remaining <= 0 || uploading > 0}
            aria-busy={uploading > 0 || undefined}
            onClick={() => fileInput.current?.click()}
          >
            <PaperclipIcon className="size-4" aria-hidden="true" />
            {uploading > 0 ? "Uploading…" : "Add attachment"}
          </Button>
          <span className="text-sm text-text-muted">
            Up to {maxAttachments} files, {formatFileSize(maxAttachmentBytes, locale)} each.
          </span>
        </div>
        <p aria-live="polite" className={cn("text-sm text-danger", !attachmentsError && "sr-only")}>
          {attachmentsError}
        </p>
      </section>
    </div>
  );
}

export {
  LessonForm,
  lessonFormLimits,
  lessonVideoInvalid,
  type LessonFormErrors,
  type LessonFormProps,
  type LessonFormValue,
};
