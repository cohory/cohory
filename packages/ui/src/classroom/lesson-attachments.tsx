import {
  FileArchiveIcon,
  FileAudioIcon,
  FileIcon,
  FileImageIcon,
  FileTextIcon,
  FileVideoIcon,
  type LucideIcon,
} from "lucide-react";
import { useId } from "react";

import { safeLinkHref } from "../community/content";
import { cn } from "../lib/utils";
import { formatFileSize, type LessonAttachment } from "./types";

const ARCHIVE_TYPES = ["zip", "x-tar", "gzip", "x-7z-compressed", "x-rar-compressed"];
const TEXT_TYPES = ["pdf", "msword", "rtf", "vnd.openxmlformats-officedocument"];

function attachmentHref(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  return safeLinkHref(trimmed);
}

export function attachmentIcon(contentType: string): LucideIcon {
  const [kind = "", subtype = ""] = contentType.toLowerCase().split("/");
  if (kind === "image") return FileImageIcon;
  if (kind === "video") return FileVideoIcon;
  if (kind === "audio") return FileAudioIcon;
  if (kind === "text") return FileTextIcon;
  if (ARCHIVE_TYPES.includes(subtype)) return FileArchiveIcon;
  if (TEXT_TYPES.some((type) => subtype.startsWith(type))) return FileTextIcon;
  return FileIcon;
}

interface LessonAttachmentsProps {
  attachments: LessonAttachment[];
  locale?: string;
  className?: string;
}

function LessonAttachments({ attachments, locale, className }: LessonAttachmentsProps) {
  const headingId = useId();
  if (attachments.length === 0) return null;
  return (
    <section
      aria-labelledby={headingId}
      data-slot="lesson-attachments"
      className={cn("flex flex-col gap-2", className)}
    >
      <h2 id={headingId} className="text-base font-medium text-text">
        Attachments
      </h2>
      <ul className="flex flex-col divide-y divide-border rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow)">
        {attachments.map((attachment, index) => {
          const Icon = attachmentIcon(attachment.contentType);
          const href = attachmentHref(attachment.href);
          const size = formatFileSize(attachment.size, locale);
          const body = (
            <>
              <Icon className="size-5 shrink-0 text-text-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
              <span className="shrink-0 text-xs text-text-muted tabular-nums">{size}</span>
            </>
          );
          return (
            <li key={attachment.id ?? `${attachment.name}-${index}`}>
              {href ? (
                <a
                  href={href}
                  download={attachment.name}
                  className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm text-text outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {body}
                  <span className="sr-only">, download</span>
                </a>
              ) : (
                <div className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm text-text-muted">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export { LessonAttachments, type LessonAttachmentsProps };
