"use client";

import { CalendarClockIcon, ImagePlusIcon, LoaderCircleIcon, VideoIcon } from "lucide-react";
import {
  useId,
  useRef,
  type ClipboardEvent,
  type ComponentProps,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { Button } from "../primitives/button";
import { Select } from "../primitives/select";
import { Textarea } from "../primitives/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "../primitives/tooltip";
import { cn } from "../lib/utils";
import { AuthorAvatar } from "./author-avatar";
import { EMBED_PROVIDER_NAMES, type EmbedBlock } from "./content";
import { MentionSuggestions, type useMentionAutocomplete } from "./mention-suggestions";
import type { PostComposerCategory } from "./post-composer-types";

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((file) => file.type.startsWith("image/"));
}

function imageDropHandlers(add: (files: File[]) => void, busy: boolean) {
  return {
    onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
      const files = imageFiles(event.clipboardData.files);
      if (files.length === 0 || busy) return;
      event.preventDefault();
      add(files);
    },
    onDragOver(event: DragEvent<HTMLDivElement>) {
      if (event.dataTransfer.types.includes("Files")) event.preventDefault();
    },
    onDrop(event: DragEvent<HTMLDivElement>) {
      const files = imageFiles(event.dataTransfer.files);
      if (files.length === 0) return;
      event.preventDefault();
      if (!busy) add(files);
    },
  };
}

function CollapsedComposer({
  shell,
  className,
  viewer,
  placeholder,
  triggerRef,
  onExpand,
  restoreOffer,
}: {
  shell: string;
  className?: string;
  viewer?: { name: string; avatarUrl?: string | null };
  placeholder: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onExpand(): void;
  restoreOffer: ReactNode;
}) {
  return (
    <div
      data-slot="post-composer"
      data-state="collapsed"
      className={cn(shell, "flex flex-wrap items-center gap-3", className)}
    >
      {viewer ? <AuthorAvatar name={viewer.name} avatarUrl={viewer.avatarUrl} /> : null}
      <button
        ref={triggerRef}
        type="button"
        onClick={onExpand}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onExpand();
          }
        }}
        className="flex h-11 flex-1 items-center rounded-full border border-input bg-surface px-4 text-left text-base text-text-muted transition-colors duration-(--duration-fast) outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:text-sm"
      >
        {placeholder}
      </button>
      {restoreOffer ? <div className="basis-full">{restoreOffer}</div> : null}
    </div>
  );
}

function CategoryField({
  categories,
  value,
  disabled,
  onChange,
}: {
  categories: readonly PostComposerCategory[];
  value: string;
  disabled: boolean;
  onChange(value: string): void;
}) {
  const fieldId = useId();
  if (categories.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={fieldId} className="text-sm text-text-muted">
        Category
      </label>
      <Select
        id={fieldId}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-auto min-w-40"
      >
        <option value="">No category</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

function ComposerBody({
  bodyRef,
  placeholder,
  text,
  onTextChange,
  readOnly,
  invalid,
  describedBy,
  mentions,
  unresolved,
  unresolvedId,
  onPaste,
  embeds,
}: {
  bodyRef: RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  text: string;
  onTextChange(text: string): void;
  readOnly: boolean;
  invalid: boolean;
  describedBy: ComponentProps<"textarea">["aria-describedby"];
  mentions: ReturnType<typeof useMentionAutocomplete>;
  unresolved: readonly string[];
  unresolvedId: string;
  onPaste(event: ClipboardEvent<HTMLTextAreaElement>): void;
  embeds: readonly EmbedBlock[];
}) {
  return (
    <>
      <div className="relative">
        <Textarea
          ref={bodyRef}
          aria-label={placeholder}
          placeholder={placeholder}
          value={text}
          readOnly={readOnly}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          {...mentions.textareaProps}
          onChange={(event) => {
            onTextChange(event.target.value);
            mentions.track(event.target.value, event.target.selectionStart);
          }}
          onKeyDown={(event) => {
            mentions.onKeyDown(event);
          }}
          onBlur={mentions.close}
          onPaste={onPaste}
          className="min-h-32 resize-y"
        />
        <MentionSuggestions {...mentions.list} />
      </div>
      {unresolved.length > 0 ? (
        <p id={unresolvedId} data-slot="unresolved-mentions" className="text-xs text-warning">
          No member found for {unresolved.map((name) => `@${name}`).join(", ")}. They won&apos;t be
          notified.
        </p>
      ) : null}
      {embeds.length > 0 ? (
        <ul aria-label="Videos to embed" className="flex flex-wrap gap-2">
          {embeds.map((embed) => (
            <li
              key={embed.url}
              className="flex items-center gap-1.5 rounded-full bg-accent-muted px-3 py-1 text-xs font-medium text-text"
            >
              <VideoIcon className="size-3.5" aria-hidden="true" />
              {EMBED_PROVIDER_NAMES[embed.provider]} video
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function ComposerActionBar({
  counter,
  submitting,
  imagesFull,
  onAddImages,
  canSchedule,
  onSchedule,
  onCancel,
  canSubmit,
  onSubmit,
  submitLabel,
}: {
  counter: ReactNode;
  submitting: boolean;
  imagesFull: boolean;
  onAddImages(files: File[]): void;
  canSchedule: boolean;
  onSchedule(): void;
  onCancel(): void;
  canSubmit: boolean;
  onSubmit(): void;
  submitLabel: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div
      data-slot="post-composer-actions"
      className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-(--z-raised) -mx-4 -mb-4 flex items-center gap-2 border-t border-border bg-surface px-4 py-3 md:static md:mx-0 md:mb-0 md:border-0 md:p-0"
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          onAddImages(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            aria-label="Add image"
            disabled={submitting || imagesFull}
            onClick={() => fileRef.current?.click()}
            className="size-11 px-0 text-text-muted"
          >
            <ImagePlusIcon className="size-5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Add image</TooltipContent>
      </Tooltip>
      {counter}
      {canSchedule ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              aria-label="Schedule for later"
              disabled={submitting}
              onClick={onSchedule}
              className="size-11 px-0 text-text-muted"
            >
              <CalendarClockIcon className="size-5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Schedule for later</TooltipContent>
        </Tooltip>
      ) : null}
      <div className="ml-auto flex gap-2">
        <Button variant="ghost" disabled={submitting} onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!canSubmit} aria-busy={submitting} onClick={onSubmit}>
          {submitting ? (
            <LoaderCircleIcon
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : null}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

export { CategoryField, CollapsedComposer, ComposerActionBar, ComposerBody, imageDropHandlers };
