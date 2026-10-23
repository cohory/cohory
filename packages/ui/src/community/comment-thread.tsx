"use client";

import { MessageSquareIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { Button } from "../primitives/button";
import { Skeleton } from "../primitives/skeleton";
import { cn } from "../lib/utils";
import type { MemberRole } from "../members/types";
import { AgentBadge } from "./agent-badge";
import { RoleBadge } from "./community-post";
import { AuthorAvatar } from "./author-avatar";
import { CommentComposer } from "./comment-composer";
import type { PostDocument } from "./content";
import { DeletedNotice, type DeletionInfo } from "./deleted-notice";
import { EmptyState } from "./empty-state";
import { ItemActionsMenu, type ItemAction } from "./item-actions";
import { LikeButton } from "./like-button";
import { PostContent } from "./post-content";
import { RelativeTime } from "./relative-time";
import type { MentionResolver } from "./resolve-mentions";

interface CommentThreadComment {
  id: string;
  parentId?: string | null;
  author: {
    id: string;
    name: string;
    avatarUrl?: string | null;
    agentName?: string | null;
    role?: MemberRole | null;
  };
  content: PostDocument;
  createdAt: string | Date;
  likeCount: number;
  likedByViewer: boolean;
  status?: "visible" | "deleted";
  deletion?: DeletionInfo | null;
  actions?: ItemAction[];
  levelBadge?: ReactNode;
}

interface CommentThreadProps {
  comments: CommentThreadComment[];
  onLike(commentId: string): void;
  onReply?(input: { parentId: string; document: PostDocument }): Promise<void> | void;
  onResolveMention?: MentionResolver;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?(): void;
  pendingNewCount?: number;
  onShowNew?(): void;
  replyError?: { parentId: string; message: ReactNode };
  now?: Date;
  className?: string;
}

interface ThreadNode {
  comment: CommentThreadComment;
  replies: CommentThreadComment[];
}

function buildThreads(comments: CommentThreadComment[]): ThreadNode[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const rootOf = (comment: CommentThreadComment): string => {
    let current = comment;
    const seen = new Set<string>();
    while (current.parentId && byId.has(current.parentId) && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = byId.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return current.id;
  };
  const threads = new Map<string, ThreadNode>();
  for (const comment of comments) {
    if (!comment.parentId || !byId.has(comment.parentId)) {
      threads.set(comment.id, { comment, replies: [] });
    }
  }
  for (const comment of comments) {
    if (threads.has(comment.id)) continue;
    threads.get(rootOf(comment))?.replies.push(comment);
  }
  return [...threads.values()];
}

interface CommentRowProps {
  comment: CommentThreadComment;
  onLike(commentId: string): void;
  onReply?(): void;
  replyButtonRef?(element: HTMLButtonElement | null): void;
  now?: Date;
  children?: ReactNode;
}

function CommentRow({ comment, onLike, onReply, replyButtonRef, now, children }: CommentRowProps) {
  if (comment.status === "deleted" && comment.deletion) {
    return (
      <li data-slot="comment" data-state="deleted" className="flex flex-col gap-3">
        <DeletedNotice noun="comment" deletion={comment.deletion} now={now}>
          <article className="flex gap-3" aria-label={`Deleted comment by ${comment.author.name}`}>
            <AuthorAvatar
              name={comment.author.name}
              avatarUrl={comment.author.avatarUrl}
              className="size-8"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
                <span className="truncate font-medium text-text">{comment.author.name}</span>
                <RelativeTime value={comment.createdAt} now={now} className="text-text-muted" />
              </div>
              <PostContent document={comment.content} variant="inline" />
            </div>
          </article>
        </DeletedNotice>
        {children}
      </li>
    );
  }

  if (comment.status === "deleted") {
    return (
      <li data-slot="comment" data-state="deleted" className="flex flex-col gap-3">
        <p className="py-2 text-sm text-text-muted italic">This comment was deleted</p>
        {children}
      </li>
    );
  }

  return (
    <li data-slot="comment" className="flex flex-col gap-3">
      <article className="flex gap-3" aria-label={`Comment by ${comment.author.name}`}>
        <AuthorAvatar
          name={comment.author.name}
          avatarUrl={comment.author.avatarUrl}
          className="size-8"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-sm">
              <span className="truncate font-medium text-text">{comment.author.name}</span>
              <RoleBadge role={comment.author.role} />
              {comment.author.agentName ? <AgentBadge name={comment.author.agentName} /> : null}
              {comment.levelBadge}
              <RelativeTime value={comment.createdAt} now={now} className="text-text-muted" />
            </div>
            <ItemActionsMenu
              actions={comment.actions ?? []}
              label="Comment options"
              className="-mt-2 -mr-2"
            />
          </div>
          <PostContent document={comment.content} variant="inline" />
          <div className="-ml-2 flex items-center gap-1">
            <LikeButton
              liked={comment.likedByViewer}
              count={comment.likeCount}
              onToggle={() => onLike(comment.id)}
            />
            {onReply ? (
              <Button
                ref={replyButtonRef}
                variant="ghost"
                onClick={onReply}
                className="min-h-11 px-2 text-text-muted"
              >
                Reply
              </Button>
            ) : null}
          </div>
        </div>
      </article>
      {children}
    </li>
  );
}

function CommentThread({
  comments,
  onLike,
  onReply,
  onResolveMention,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  pendingNewCount = 0,
  onShowNew,
  replyError,
  now,
  className,
}: CommentThreadProps) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const replyButtons = useRef(new Map<string, HTMLButtonElement>());
  const threads = buildThreads(comments);

  function closeReply(threadId: string) {
    setReplyingTo(null);
    replyButtons.current.get(threadId)?.focus();
  }

  function registerReplyButton(id: string) {
    return (element: HTMLButtonElement | null) => {
      if (element) replyButtons.current.set(id, element);
      else replyButtons.current.delete(id);
    };
  }

  return (
    <section
      data-slot="comment-thread"
      aria-label="Comments"
      className={cn("flex flex-col gap-4", className)}
    >
      {pendingNewCount > 0 && onShowNew ? (
        <Button variant="secondary" size="sm" className="self-center" onClick={onShowNew}>
          {pendingNewCount === 1 ? "1 new comment" : `${pendingNewCount} new comments`}
        </Button>
      ) : null}
      {threads.length === 0 ? (
        <EmptyState
          icon={<MessageSquareIcon />}
          title="No comments yet"
          description="Start the conversation."
        />
      ) : (
        <ul aria-live="polite" className="flex flex-col gap-4">
          {threads.map(({ comment, replies }) => {
            const replyHandler = onReply ? () => setReplyingTo(comment.id) : undefined;
            return (
              <CommentRow
                key={comment.id}
                comment={comment}
                onLike={onLike}
                onReply={replyHandler}
                replyButtonRef={registerReplyButton(comment.id)}
                now={now}
              >
                {replies.length > 0 || replyingTo === comment.id ? (
                  <ul className="flex flex-col gap-3 border-l border-border pl-6 md:pl-10">
                    {replies.map((reply) => (
                      <CommentRow
                        key={reply.id}
                        comment={reply}
                        onLike={onLike}
                        onReply={replyHandler}
                        now={now}
                      />
                    ))}
                    {onReply && replyingTo === comment.id ? (
                      <li>
                        <CommentComposer
                          autoFocus
                          label={`Reply to ${comment.author.name}`}
                          placeholder="Write a reply"
                          onResolveMention={onResolveMention}
                          error={
                            replyError?.parentId === comment.id ? replyError.message : undefined
                          }
                          onCancel={() => closeReply(comment.id)}
                          onSubmit={async (document) => {
                            await onReply({ parentId: comment.id, document });
                            closeReply(comment.id);
                          }}
                        />
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </CommentRow>
            );
          })}
        </ul>
      )}
      {hasMore && onLoadMore ? (
        <Button
          variant="ghost"
          className="self-start text-accent"
          disabled={loadingMore}
          aria-busy={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? "Loading comments…" : "Show more comments"}
        </Button>
      ) : null}
    </section>
  );
}

function CommentThreadSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div
      data-slot="comment-thread-skeleton"
      role="status"
      aria-label="Loading comments"
      className={cn("flex flex-col gap-4", className)}
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export { CommentThread, CommentThreadSkeleton, type CommentThreadComment, type CommentThreadProps };
