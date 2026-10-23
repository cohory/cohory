"use client";

import { Button, Label } from "@cohory/ui";
import { cn } from "@cohory/ui/lib/utils";
import { ImageUp } from "lucide-react";
import { useId, useRef, useState, useTransition } from "react";

import type { AppearanceResult } from "../../lib/manage/actions";
import type { ActionResult } from "../../lib/posts/errors";
import { StoredImage } from "../stored-image";

const uploadLimit = 5 * 1024 * 1024;

const frames = {
  logo: { box: "h-28", image: "object-contain" },
  cover: { box: "aspect-[4/1] w-full", image: "object-cover" },
} as const;

export function BrandingUpload({
  label,
  description,
  frame,
  imageUrl,
  onUpload,
  onRemove,
  onDone,
}: {
  label: string;
  description: string;
  frame: keyof typeof frames;
  imageUrl: string | null;
  onUpload(data: FormData): Promise<ActionResult<AppearanceResult>>;
  onRemove(): Promise<ActionResult<AppearanceResult>>;
  onDone(result: AppearanceResult): void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(task: () => Promise<ActionResult<AppearanceResult>>) {
    startTransition(async () => {
      const result = await task();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      onDone(result.data);
    });
  }

  function choose(file: File | undefined) {
    if (!file) return;
    if (file.size > uploadLimit) {
      setError("That image is too large. Choose one under 5 MB.");
      return;
    }
    const data = new FormData();
    data.set("file", file);
    run(() => onUpload(data));
    if (input.current) input.current.value = "";
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div
        data-slot="branding-preview"
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-surface-hover",
          frames[frame].box,
        )}
      >
        {imageUrl ? (
          // Branding comes from the storage driver's public URL, which may be any S3 host.
          <StoredImage src={imageUrl} alt="" className={cn("h-full w-full", frames[frame].image)} />
        ) : (
          <ImageUp aria-hidden="true" className="size-6 text-text-subtle" strokeWidth={1.5} />
        )}
      </div>
      <p className="text-sm text-text-muted">{description}</p>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        onChange={(event) => choose(event.target.files?.[0])}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          disabled={pending}
          onClick={() => input.current?.click()}
        >
          {pending ? "Uploading…" : imageUrl ? "Replace" : "Upload"}
        </Button>
        {imageUrl ? (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            disabled={pending}
            onClick={() => run(onRemove)}
          >
            Remove
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
