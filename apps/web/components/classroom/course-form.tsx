"use client";

import { Button, Field, Input, Select, Textarea, type LevelOption } from "@cohory/ui";
import { useFocusFirstError } from "@cohory/ui/lib/use-focus-first-error";
import { useUnsavedChanges } from "@cohory/ui/lib/use-unsaved-changes";
import { ImageIcon, XIcon } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { uploadPostImage } from "../feed/client-helpers";
import { useWideScreenFocus } from "../use-wide-screen-focus";
import { StoredImage } from "../stored-image";

export interface CourseFormValue {
  title: string;
  description: string;
  coverKey: string | null;
  coverUrl: string | null;
  requiredLevel?: number | null;
}

export const courseFormLimits = { title: 120, description: 2000 } as const;

export const saveFailedMessage =
  "We couldn't save your changes. Check your connection and try again.";

type CourseField = "title" | "description";

export interface CourseFormFailure {
  message: string;
  fieldErrors?: Partial<Record<string, string>>;
}

export interface CourseFormProps {
  slug: string;
  initial: CourseFormValue;
  submitLabel: string;
  pendingLabel: string;
  levels?: readonly LevelOption[];
  onSubmit(value: CourseFormValue): Promise<CourseFormFailure | null>;
  onCancel?(): void;
}

type FormErrors = { fields: Partial<Record<CourseField, string>>; form: string | null };

const noErrors: FormErrors = { fields: {}, form: null };

function toFormErrors(failure: CourseFormFailure): FormErrors {
  const fields: Partial<Record<CourseField, string>> = {};
  const title = failure.fieldErrors?.title;
  const description = failure.fieldErrors?.description;
  if (title) fields.title = title;
  if (description) fields.description = description;
  const placed = Boolean(title ?? description);
  return { fields, form: placed ? null : failure.message };
}

export function CourseForm({
  slug,
  initial,
  submitLabel,
  pendingLabel,
  levels = [],
  onSubmit,
  onCancel,
}: CourseFormProps) {
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>(noErrors);
  const [offline, setOffline] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useFocusFirstError<HTMLFormElement>(errors.fields);
  const focusOnWideScreen = useWideScreenFocus<HTMLInputElement>();
  const dirty =
    value.title !== initial.title ||
    value.description !== initial.description ||
    value.coverKey !== initial.coverKey ||
    value.requiredLevel !== initial.requiredLevel;
  useUnsavedChanges(dirty && !pending);
  const titleLeft = courseFormLimits.title - value.title.length;

  async function chooseCover(file: File | undefined) {
    if (!file) return;
    setCoverError(null);
    setUploading(true);
    try {
      const uploaded = await uploadPostImage(slug, file);
      setValue((current) => ({ ...current, coverKey: uploaded.key, coverUrl: uploaded.url }));
    } catch (uploadError) {
      setCoverError(
        uploadError instanceof Error ? uploadError.message : "The image didn't upload.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (pending) return;
    setOffline(false);
    if (value.title.trim() === "") {
      setErrors({ fields: { title: "Give your course a title." }, form: null });
      return;
    }
    setErrors(noErrors);
    setPending(true);
    try {
      const failure = await onSubmit(value);
      if (failure) {
        setErrors(toFormErrors(failure));
        setPending(false);
      }
    } catch {
      setOffline(true);
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save();
  }

  return (
    <form ref={formRef} noValidate onSubmit={submit} className="flex flex-col gap-6">
      <Field
        label="Title"
        description={titleLeft <= 20 ? `${titleLeft} characters left` : undefined}
        error={errors.fields.title}
      >
        {(control) => (
          <Input
            {...control}
            value={value.title}
            maxLength={courseFormLimits.title}
            required
            ref={focusOnWideScreen}
            onChange={(event) => setValue({ ...value, title: event.target.value })}
          />
        )}
      </Field>
      <Field
        label="Short description"
        description="Optional. Shown on the course card."
        error={errors.fields.description}
      >
        {(control) => (
          <Textarea
            {...control}
            value={value.description}
            rows={3}
            maxLength={courseFormLimits.description}
            onChange={(event) => setValue({ ...value, description: event.target.value })}
          />
        )}
      </Field>
      {levels.length > 1 ? (
        <Field
          label="Who can open it"
          description="Members below the level see the course locked until they reach it."
        >
          {(control) => (
            <Select
              {...control}
              value={String(value.requiredLevel ?? "")}
              onChange={(event) => {
                const level = Number(event.target.value);
                setValue({ ...value, requiredLevel: level > 1 ? level : null });
              }}
            >
              <option value="">All members</option>
              {levels
                .filter((option) => option.level > 1)
                .map((option) => (
                  <option key={option.level} value={option.level}>
                    {option.name
                      ? `Level ${option.level} (${option.name}) and up`
                      : `Level ${option.level} and up`}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      ) : null}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-text">Cover image</span>
        {value.coverUrl ? (
          <div className="relative w-full max-w-sm overflow-hidden rounded-md border border-border">
            <StoredImage src={value.coverUrl} alt="" className="aspect-video w-full object-cover" />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label="Remove cover image"
              onClick={() => setValue({ ...value, coverKey: null, coverUrl: null })}
              className="absolute top-2 right-2"
            >
              <XIcon className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ) : null}
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          aria-label="Cover image file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void chooseCover(file);
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={uploading}
            aria-busy={uploading || undefined}
            onClick={() => fileInput.current?.click()}
          >
            <ImageIcon className="size-4" aria-hidden="true" />
            {uploading ? "Uploading…" : value.coverUrl ? "Change cover" : "Add cover"}
          </Button>
          <span className="text-sm text-text-muted">Optional. A wide image works best.</span>
        </div>
        <p aria-live="polite" className={coverError ? "text-sm text-danger" : "sr-only"}>
          {coverError}
        </p>
      </div>
      {errors.form || offline ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          <p>{offline ? saveFailedMessage : errors.form}</p>
          {offline ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => void save()}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={pending || uploading} aria-busy={pending || undefined}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
