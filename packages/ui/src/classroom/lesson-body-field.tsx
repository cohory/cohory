"use client";

import {
  BoldIcon,
  CodeIcon,
  HeadingIcon,
  ImageIcon,
  LinkIcon,
  ListIcon,
  type LucideIcon,
} from "lucide-react";
import {
  useDeferredValue,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";

import { Button } from "../primitives/button";
import { Field } from "../primitives/field";
import { Textarea } from "../primitives/textarea";
import { cn } from "../lib/utils";
import { lessonProseClassName } from "./lesson-player";
import {
  applyMarkdownFormat,
  imageAltFromFileName,
  insertBlock,
  type MarkdownFormat,
  type TextEdit,
} from "./markdown-edit";
import { formatFileSize } from "./types";

interface LessonBodyFieldProps {
  value: string;
  onChange(value: string): void;
  error?: string;
  maxLength: number;
  disabled: boolean;
  onUploadImage?(file: File): Promise<{ src: string }>;
  renderPreview?(markdown: string): string;
  blockedImages?: readonly string[];
  maxImageBytes?: number;
  locale?: string;
}

const lessonImageTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const lessonImageMaxBytes = 10 * 1024 * 1024;

const formats: { format: MarkdownFormat; label: string; icon: LucideIcon }[] = [
  { format: "heading", label: "Heading", icon: HeadingIcon },
  { format: "bold", label: "Bold", icon: BoldIcon },
  { format: "list", label: "List", icon: ListIcon },
  { format: "link", label: "Link", icon: LinkIcon },
  { format: "code", label: "Code", icon: CodeIcon },
];

const toolClass = "size-11 px-0";

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((file) => file.type.startsWith("image/"));
}

function LessonBodyField({
  value,
  onChange,
  error,
  maxLength,
  disabled,
  onUploadImage,
  renderPreview,
  blockedImages = [],
  maxImageBytes = lessonImageMaxBytes,
  locale,
}: LessonBodyFieldProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const latest = useRef(value);
  useLayoutEffect(() => {
    latest.current = value;
  });
  const warningId = useId();
  const [view, setView] = useState<"write" | "preview">("write");
  const [uploading, setUploading] = useState(0);
  const [imageError, setImageError] = useState<string | null>(null);
  const deferred = useDeferredValue(value);
  const previewHtml = renderPreview ? renderPreview(deferred) : "";

  function selection(): [number, number] {
    const field = textarea.current;
    const end = latest.current.length;
    return field ? [field.selectionStart, field.selectionEnd] : [end, end];
  }

  function apply(edit: TextEdit) {
    onChange(edit.text);
    requestAnimationFrame(() => {
      const field = textarea.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  }

  function format(kind: MarkdownFormat) {
    const [start, end] = selection();
    apply(applyMarkdownFormat(latest.current, start, end, kind));
  }

  async function uploadImages(files: File[]) {
    if (!onUploadImage || files.length === 0) return;
    setImageError(null);
    for (const file of files) {
      if (!lessonImageTypes.includes(file.type)) {
        setImageError(`${file.name} isn't an image. Use PNG, JPEG, GIF, or WebP.`);
        return;
      }
      if (file.size > maxImageBytes) {
        setImageError(`${file.name} is larger than ${formatFileSize(maxImageBytes, locale)}.`);
        return;
      }
    }
    setUploading((count) => count + files.length);
    for (const file of files) {
      try {
        const { src } = await onUploadImage(file);
        const [start, end] = selection();
        const block = `![${imageAltFromFileName(file.name)}](${src})`;
        apply(insertBlock(latest.current, start, end, block));
      } catch (uploadError) {
        setImageError(
          uploadError instanceof Error && uploadError.message
            ? uploadError.message
            : `Couldn't upload ${file.name}. Try again.`,
        );
      } finally {
        setUploading((count) => count - 1);
      }
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = imageFiles(event.clipboardData.files);
    if (!onUploadImage || files.length === 0) return;
    event.preventDefault();
    void uploadImages(files);
  }

  function onDrop(event: DragEvent<HTMLTextAreaElement>) {
    const files = imageFiles(event.dataTransfer.files);
    if (!onUploadImage || files.length === 0) return;
    event.preventDefault();
    void uploadImages(files);
  }

  const status = uploading > 0 ? "Uploading image…" : imageError;

  return (
    <Field
      label="Lesson content"
      description="Write in Markdown, or use the buttons. Paste or drop images to add them."
      error={error}
    >
      {(control) => (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-1">
              {formats.map(({ format: kind, label, icon: Icon }) => (
                <Button
                  key={kind}
                  type="button"
                  variant="ghost"
                  className={toolClass}
                  aria-label={label}
                  title={label}
                  disabled={disabled || view === "preview"}
                  onClick={() => format(kind)}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </Button>
              ))}
              {onUploadImage ? (
                <Button
                  type="button"
                  variant="ghost"
                  className={toolClass}
                  aria-label="Add image"
                  title="Add image"
                  disabled={disabled || uploading > 0}
                  aria-busy={uploading > 0 || undefined}
                  onClick={() => imageInput.current?.click()}
                >
                  <ImageIcon className="size-4" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
            {renderPreview ? (
              <div className="ml-auto flex gap-1 lg:hidden">
                {(["write", "preview"] as const).map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant={view === option ? "secondary" : "ghost"}
                    aria-pressed={view === option}
                    className="min-h-11"
                    onClick={() => setView(option)}
                  >
                    {option === "write" ? "Write" : "Preview"}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
          {onUploadImage ? (
            <input
              ref={imageInput}
              type="file"
              accept={lessonImageTypes.join(",")}
              multiple
              hidden
              aria-label="Image file"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                void uploadImages(files);
              }}
            />
          ) : null}
          <div className={cn("grid gap-4", renderPreview && "lg:grid-cols-2")}>
            <Textarea
              {...control}
              ref={textarea}
              value={value}
              maxLength={maxLength}
              rows={16}
              disabled={disabled}
              aria-describedby={
                [control["aria-describedby"], blockedImages.length > 0 ? warningId : null]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              onChange={(event) => onChange(event.target.value)}
              onPaste={onPaste}
              onDrop={onDrop}
              className={cn("font-mono", view === "preview" && "hidden lg:flex")}
            />
            {renderPreview ? (
              <section
                aria-label="Preview"
                className={cn(
                  "min-h-40 overflow-auto rounded-md border border-border bg-surface p-4 lg:max-h-[32rem]",
                  view === "write" && "hidden lg:block",
                )}
              >
                {previewHtml.trim() ? (
                  <div
                    className={lessonProseClassName}
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                ) : (
                  <p className="text-sm text-text-muted">Nothing to preview yet.</p>
                )}
              </section>
            ) : null}
          </div>
          {blockedImages.length > 0 ? (
            <div
              id={warningId}
              role="status"
              aria-label="Images that won't show"
              className="flex flex-col gap-1 rounded-md bg-warning-muted p-3 text-sm text-text"
            >
              <p>
                {blockedImages.length === 1
                  ? "This image won't show to members because it is hosted on another site. Upload it with Add image instead."
                  : "These images won't show to members because they are hosted on other sites. Upload them with Add image instead."}
              </p>
              <ul className="list-disc pl-5 break-all text-text-muted">
                {blockedImages.map((src) => (
                  <li key={src}>{src}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p
            aria-live="polite"
            className={cn(
              "text-sm",
              imageError ? "text-danger" : "text-text-muted",
              !status && "sr-only",
            )}
          >
            {status}
          </p>
        </div>
      )}
    </Field>
  );
}

export { LessonBodyField, lessonImageMaxBytes, lessonImageTypes, type LessonBodyFieldProps };
