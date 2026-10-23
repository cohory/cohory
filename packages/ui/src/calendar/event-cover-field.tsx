"use client";

import { ImageIcon, XIcon } from "lucide-react";
import { useId, useRef } from "react";

import { Button } from "../primitives/button";

const coverTypes = "image/png,image/jpeg,image/webp,image/gif";

interface EventCoverFieldProps {
  coverUrl: string | null;
  onFile(file: File): void;
  onRemove(): void;
  uploading?: boolean;
  error?: string;
  disabled?: boolean;
}

function EventCoverField({
  coverUrl,
  onFile,
  onRemove,
  uploading = false,
  error,
  disabled = false,
}: EventCoverFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const busy = disabled || uploading;

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2">
      <span id={labelId} className="text-sm font-medium text-text">
        Cover image
      </span>
      {coverUrl ? (
        <img
          src={coverUrl}
          alt=""
          className="aspect-video w-full max-w-sm rounded-md border border-border object-cover"
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          aria-busy={uploading || undefined}
          onClick={() => input.current?.click()}
        >
          <ImageIcon className="size-4" aria-hidden="true" />
          {uploading ? "Uploading…" : coverUrl ? "Change cover" : "Add cover"}
        </Button>
        {coverUrl ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={onRemove}>
            <XIcon className="size-4" aria-hidden="true" />
            Remove cover
          </Button>
        ) : null}
      </div>
      <input
        ref={input}
        type="file"
        accept={coverTypes}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { EventCoverField, type EventCoverFieldProps };
