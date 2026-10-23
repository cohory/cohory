"use client";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Field,
  RelativeTime,
  Textarea,
  toast,
} from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteReplyAction, saveReplyAction } from "../../lib/reviews/actions";
import type { ReviewRow } from "../../lib/reviews/views";
import { Stars } from "./stars";

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function ReplyEditor({
  slug,
  reviewId,
  initial,
  onDone,
}: {
  slug: string;
  reviewId: string;
  initial: string | null;
  onDone(): void;
}) {
  const router = useRouter();
  const [body, setBody] = useState(initial ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await saveReplyAction({ slug, reviewId, body, edit: initial !== null });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success("Reply saved.");
      onDone();
      router.refresh();
    });
  }

  return (
    <form
      aria-label="Reply to this review"
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Field label="Your public reply">
        {(control) => (
          <Textarea
            {...control}
            rows={3}
            maxLength={2000}
            required
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        )}
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" className="min-h-11" disabled={pending}>
          Save reply
        </Button>
        <Button type="button" variant="secondary" className="min-h-11" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ReviewItem({
  slug,
  row,
  canReply,
  canReport,
  onReport,
}: {
  slug: string;
  row: ReviewRow;
  canReply: boolean;
  canReport: boolean;
  onReport(): void;
}) {
  const router = useRouter();
  const [replying, setReplying] = useState(false);
  const [pending, startTransition] = useTransition();

  function removeReply() {
    startTransition(async () => {
      const result = await deleteReplyAction({ slug, reviewId: row.id });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Reply deleted.");
      router.refresh();
    });
  }

  return (
    <li
      aria-label={`Review by ${row.authorName}`}
      className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0"
    >
      <div className="flex items-start gap-3">
        <Avatar className="size-10">
          {row.authorImage ? <AvatarImage src={row.authorImage} alt="" /> : null}
          <AvatarFallback className="text-accent" aria-hidden="true">
            {initials(row.authorName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium text-text">{row.authorName}</p>
          <p className="text-sm text-text-muted">{row.statusLabel}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
        <Stars rating={row.rating} label={`${row.rating} out of 5 stars`} />
        <RelativeTime value={row.createdAt} />
        {row.edited ? <span>(edited)</span> : null}
      </div>
      <p className="text-base break-words whitespace-pre-line text-text">{row.body}</p>
      {row.reply && !replying ? (
        <div className="ml-4 flex flex-col gap-1 border-l-2 border-border pl-3">
          <p className="text-sm font-medium text-text">
            Reply from the owner{row.reply.edited ? " (edited)" : ""}
          </p>
          <p className="text-sm break-words whitespace-pre-line text-text">{row.reply.body}</p>
        </div>
      ) : null}
      {replying ? (
        <ReplyEditor
          slug={slug}
          reviewId={row.id}
          initial={row.reply?.body ?? null}
          onDone={() => setReplying(false)}
        />
      ) : null}
      {!replying && (canReply || canReport) ? (
        <div className="flex flex-wrap gap-2">
          {canReply ? (
            <Button
              variant="ghost"
              className="min-h-11"
              disabled={pending}
              onClick={() => setReplying(true)}
            >
              {row.reply ? "Edit reply" : "Reply"}
            </Button>
          ) : null}
          {canReply && row.reply ? (
            <Button variant="ghost" className="min-h-11" disabled={pending} onClick={removeReply}>
              Delete reply
            </Button>
          ) : null}
          {canReport ? (
            <Button variant="ghost" className="min-h-11" onClick={onReport}>
              Report
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
