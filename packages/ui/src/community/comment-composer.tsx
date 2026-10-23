"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useId, useState, type ReactNode, type Ref } from "react";

import { formatCount } from "../lib/format-number";
import { Button } from "../primitives/button";
import { Textarea } from "../primitives/textarea";
import { cn } from "../lib/utils";
import { composeDocument } from "./compose-document";
import type { PostDocument } from "./content";
import { resolveMentions, type MentionResolver } from "./resolve-mentions";

interface CommentComposerProps {
  onSubmit(document: PostDocument): Promise<void> | void;
  onCancel?(): void;
  onResolveMention?: MentionResolver;
  placeholder?: string;
  label?: string;
  maxLength?: number;
  error?: ReactNode;
  autoFocus?: boolean;
  className?: string;
  ref?: Ref<HTMLTextAreaElement>;
}

function CommentComposer({
  onSubmit,
  onCancel,
  onResolveMention,
  placeholder = "Write a comment",
  label,
  maxLength = 5_000,
  error,
  autoFocus,
  className,
  ref,
}: CommentComposerProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const counterId = useId();
  const overLimit = text.length > maxLength;
  const canSubmit = text.trim() !== "" && !overLimit && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const resolveMention = await resolveMentions(text, onResolveMention);
      await onSubmit(composeDocument(text, [], [], { resolveMention, blocks: "paragraphs" }));
      setText("");
    } catch {
      return;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-slot="comment-composer"
      className={cn("flex flex-col gap-2", className)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && onCancel) {
          event.preventDefault();
          onCancel();
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void submit();
        }
      }}
    >
      <Textarea
        ref={ref}
        aria-label={label ?? placeholder}
        placeholder={placeholder}
        value={text}
        readOnly={submitting}
        autoFocus={autoFocus}
        aria-invalid={overLimit || undefined}
        aria-describedby={overLimit ? counterId : undefined}
        onChange={(event) => setText(event.target.value)}
        className="min-h-20"
      />
      {error ? (
        <div role="alert" className="text-sm text-danger">
          {error}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <div aria-live="polite" className="mr-auto">
          {overLimit ? (
            <p id={counterId} className="text-xs font-medium text-danger tabular-nums">
              {formatCount(text.length - maxLength)} characters over the limit
            </p>
          ) : null}
        </div>
        {onCancel ? (
          <Button variant="ghost" size="sm" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button
          size="sm"
          disabled={!canSubmit}
          aria-busy={submitting}
          onClick={() => void submit()}
        >
          {submitting ? (
            <LoaderCircleIcon
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : null}
          Post
        </Button>
      </div>
    </div>
  );
}

export { CommentComposer, type CommentComposerProps };
