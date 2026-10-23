"use client";

import { LoaderCircleIcon, TriangleAlertIcon, XIcon } from "lucide-react";

import { cn } from "../lib/utils";
import type { Attachment } from "./use-image-attachments";

interface ComposerAttachmentsProps {
  attachments: Attachment[];
  onRemove(localId: string): void;
  disabled?: boolean;
}

function ComposerAttachments({ attachments, onRemove, disabled }: ComposerAttachmentsProps) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label="Attached images" className="flex gap-2 overflow-x-auto pb-1">
      {attachments.map((attachment, index) => {
        const src = attachment.status === "uploaded" ? attachment.image.url : attachment.previewUrl;
        return (
          <li
            key={attachment.localId}
            className="relative size-24 shrink-0 overflow-hidden rounded-md border border-border bg-surface-hover"
          >
            {src ? (
              <img
                src={src}
                alt={`Image ${index + 1}: ${attachment.name}`}
                className={cn(
                  "size-full object-cover",
                  attachment.status === "uploading" && "opacity-60",
                )}
              />
            ) : null}
            {attachment.status === "uploading" ? (
              <span className="absolute inset-0 flex items-center justify-center text-text">
                <LoaderCircleIcon
                  className="size-5 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                <span className="sr-only">Uploading {attachment.name}</span>
              </span>
            ) : null}
            {attachment.status === "failed" ? (
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-danger-muted p-1 text-center text-xs text-danger">
                <TriangleAlertIcon className="size-4" aria-hidden="true" />
                Upload failed
              </span>
            ) : null}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(attachment.localId)}
              aria-label={`Remove ${attachment.name}`}
              className="group absolute top-0 right-0 flex size-11 items-start justify-end p-1 text-text outline-none disabled:text-text-subtle"
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-surface-raised shadow-sm group-hover:bg-surface-hover group-focus-visible:ring-2 group-focus-visible:ring-ring">
                <XIcon className="size-4" aria-hidden="true" />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export { ComposerAttachments, type ComposerAttachmentsProps };
