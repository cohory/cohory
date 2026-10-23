"use client";

import { MessageSquareIcon, PinIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { Skeleton } from "../primitives/skeleton";
import { formatCount } from "../lib/format-number";
import { Link } from "../lib/link";
import { cn } from "../lib/utils";
import { roleLabel, type MemberRole } from "../members/types";
import { AgentBadge } from "./agent-badge";
import { AuthorAvatar } from "./author-avatar";
import type { Block, PostDocument } from "./content";
import { DeletedNotice, type DeletionInfo } from "./deleted-notice";
import { ItemActionsMenu, type ItemAction } from "./item-actions";
import { LikeButton } from "./like-button";
import { PostContent } from "./post-content";
import { RelativeTime } from "./relative-time";

type CommunityPostVariant = "feed" | "detail";

interface CommunityPostAuthor {
  id: string;
  name: string;
  avatarUrl?: string | null;
  agentName?: string | null;
  role?: MemberRole | null;
}

interface CommunityPostPerson {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

interface CommunityPostConversation {
  recentCommenters: readonly CommunityPostPerson[];
  lastCommentAt: string | Date;
}

interface CommunityPostData {
  id: string;
  title?: string | null;
  content: PostDocument;
  createdAt: string | Date;
  pinned?: boolean;
  category?: string | null;
  status?: "visible" | "deleted";
  deletion?: DeletionInfo | null;
  isNew?: boolean;
  conversation?: CommunityPostConversation | null;
}

interface CommunityPostProps {
  post: CommunityPostData;
  author: CommunityPostAuthor;
  likeCount: number;
  likedByViewer: boolean;
  commentCount: number;
  onLike(): void;
  variant?: CommunityPostVariant;
  href?: string;
  commentsHref?: string;
  onOpenComments?(): void;
  levelBadge?: ReactNode;
  actions?: ItemAction[];
  footerEnd?: ReactNode;
  now?: Date;
  className?: string;
}

const COLLAPSE_LINE_BUDGET = 6;
const CHARACTERS_PER_LINE = 70;

function estimatedLines(blocks: Block[]): number {
  let lines = 0;
  for (const block of blocks) {
    if (block.type === "paragraph") {
      const text = block.content
        .map((node) => (node.type === "text" ? node.text : node.label))
        .join("");
      lines += text
        .split("\n")
        .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / CHARACTERS_PER_LINE)), 0);
    } else if (block.type === "bulletList") {
      lines += block.items.length;
    }
  }
  return lines;
}

function splitContent(document: PostDocument): { text: PostDocument; media: PostDocument } {
  const blocks = Array.isArray(document.content) ? document.content : [];
  return {
    text: {
      type: "doc",
      content: blocks.filter((block) => block.type === "paragraph" || block.type === "bulletList"),
    },
    media: {
      type: "doc",
      content: blocks.filter((block) => block.type === "image" || block.type === "embed"),
    },
  };
}

function commentLabel(count: number): string {
  return count === 1 ? "1 comment" : `${formatCount(count)} comments`;
}

function RoleBadge({ role }: { role: MemberRole | null | undefined }) {
  const label = role ? roleLabel(role) : null;
  return label ? (
    <Badge variant="neutral" data-slot="role-badge">
      {label}
    </Badge>
  ) : null;
}

function ConversationLife({
  conversation,
  now,
}: {
  conversation: CommunityPostConversation;
  now?: Date;
}) {
  const people = conversation.recentCommenters.slice(0, 3);
  return (
    <div
      data-slot="conversation-life"
      className="flex min-w-0 items-center gap-2 text-xs text-text-muted"
    >
      {people.length > 0 ? (
        <ul className="flex -space-x-2" aria-label="Recent commenters">
          {people.map((person) => (
            <li key={person.id} title={person.name}>
              <AuthorAvatar
                name={person.name}
                avatarUrl={person.avatarUrl}
                className="size-6 ring-2 ring-surface"
              />
              <span className="sr-only">{person.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <span className="truncate">
        Last comment <RelativeTime value={conversation.lastCommentAt} now={now} />
      </span>
    </div>
  );
}

const articleClasses =
  "relative flex flex-col gap-3 border-y border-border bg-surface p-4 text-text md:rounded-(--card-radius) md:border-x md:shadow-(--card-shadow)";

function CommunityPost({
  post,
  author,
  likeCount,
  likedByViewer,
  commentCount,
  onLike,
  variant = "feed",
  href,
  commentsHref,
  onOpenComments,
  levelBadge,
  actions = [],
  footerEnd,
  now,
  className,
}: CommunityPostProps) {
  const [expanded, setExpanded] = useState(false);
  const titleId = useId();
  const bodyId = useId();

  if (post.status === "deleted" && post.deletion) {
    const title = post.title?.trim();
    return (
      <article
        data-slot="community-post"
        data-state="deleted"
        aria-label={title ? `Deleted post: ${title}` : "Deleted post"}
        className={cn(articleClasses, className)}
      >
        <DeletedNotice noun="post" deletion={post.deletion} now={now}>
          <header className="flex items-start gap-3">
            <AuthorAvatar name={author.name} avatarUrl={author.avatarUrl} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-text">{author.name}</span>
              <RelativeTime value={post.createdAt} now={now} className="text-sm text-text-muted" />
            </div>
          </header>
          {title ? <h2 className="text-lg font-semibold text-text">{title}</h2> : null}
          <PostContent document={post.content} />
        </DeletedNotice>
      </article>
    );
  }

  if (post.status === "deleted") {
    return (
      <article
        data-slot="community-post"
        data-state="deleted"
        className={cn(articleClasses, "text-sm text-text-muted", className)}
      >
        This post was removed
      </article>
    );
  }

  const isFeed = variant === "feed";
  const { text, media } = splitContent(post.content);
  const collapsible = isFeed && estimatedLines(text.content) > COLLAPSE_LINE_BUDGET;
  const clamped = collapsible && !expanded;
  const title = post.title?.trim();
  const cardLink = isFeed && href;
  const stretchedLink =
    "outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring";

  return (
    <article
      data-slot="community-post"
      data-variant={variant}
      aria-labelledby={title ? titleId : undefined}
      className={cn(
        articleClasses,
        isFeed &&
          "transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-surface-hover",
        className,
      )}
    >
      {post.pinned ? (
        <p className="flex items-center gap-1 text-xs font-medium text-text-muted">
          <PinIcon className="size-3.5" aria-hidden="true" />
          Pinned
        </p>
      ) : null}
      <header className="flex items-start gap-3">
        <AuthorAvatar name={author.name} avatarUrl={author.avatarUrl} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2">
            <span className="truncate text-sm font-medium text-text">{author.name}</span>
            <RoleBadge role={author.role} />
            {author.agentName ? <AgentBadge name={author.agentName} /> : null}
            {levelBadge}
            {isFeed && post.isNew ? (
              <Badge variant="accent" data-slot="new-badge">
                New
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-1 text-sm text-text-muted">
            {cardLink && !title ? (
              <Link href={href} className={stretchedLink}>
                <RelativeTime value={post.createdAt} now={now} />
              </Link>
            ) : (
              <RelativeTime value={post.createdAt} now={now} />
            )}
            {post.category ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{post.category}</span>
              </>
            ) : null}
          </div>
        </div>
        <ItemActionsMenu actions={actions} label="Post options" className="-mt-2 -mr-2" />
      </header>

      {title ? (
        <h2 id={titleId} className="text-lg font-semibold text-text">
          {cardLink ? (
            <Link href={href} className={stretchedLink}>
              {title}
            </Link>
          ) : (
            title
          )}
        </h2>
      ) : null}

      {text.content.length > 0 ? (
        <div className="relative flex flex-col items-start gap-1">
          <PostContent
            id={bodyId}
            document={text}
            className={cn("w-full", clamped && "max-h-36 overflow-hidden")}
          />
          {collapsible ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={bodyId}
              onClick={() => setExpanded((value) => !value)}
              className="relative min-h-11 rounded-sm text-sm font-medium text-accent outline-none hover:text-accent-hover focus-visible:ring-2 focus-visible:ring-ring"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          ) : null}
        </div>
      ) : null}

      {media.content.length > 0 ? <PostContent document={media} className="relative" /> : null}

      <footer className="-mb-2 -ml-2 flex items-center gap-1">
        <LikeButton liked={likedByViewer} count={likeCount} onToggle={onLike} />
        {commentsHref ? (
          <Link
            href={commentsHref}
            aria-label={commentLabel(commentCount)}
            className="relative inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-text-muted outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MessageSquareIcon className="size-4" aria-hidden="true" />
            <span aria-hidden="true" className="tabular-nums">
              {formatCount(commentCount)}
            </span>
          </Link>
        ) : (
          <Button
            variant="ghost"
            aria-label={commentLabel(commentCount)}
            onClick={onOpenComments}
            className="relative min-h-11 px-2 text-text-muted"
          >
            <MessageSquareIcon className="size-4" aria-hidden="true" />
            <span aria-hidden="true" className="tabular-nums">
              {formatCount(commentCount)}
            </span>
          </Button>
        )}
        {isFeed && post.conversation ? (
          <ConversationLife conversation={post.conversation} now={now} />
        ) : null}
        {footerEnd ? <div className="relative ml-auto">{footerEnd}</div> : null}
      </footer>
    </article>
  );
}

function CommunityPostSkeleton({ className }: { className?: string }) {
  return (
    <div
      data-slot="community-post-skeleton"
      role="status"
      aria-label="Loading post"
      className={cn(articleClasses, className)}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <Skeleton className="h-6 w-2/3" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      <div className="flex gap-4">
        <Skeleton className="h-6 w-12" />
        <Skeleton className="h-6 w-12" />
      </div>
    </div>
  );
}

function CommunityPostError({ onRetry, className }: { onRetry(): void; className?: string }) {
  return (
    <div
      data-slot="community-post-error"
      role="alert"
      className={cn(articleClasses, "flex-row items-center justify-between text-sm", className)}
    >
      <span className="text-text">Couldn't load this post.</span>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export {
  CommunityPost,
  CommunityPostError,
  CommunityPostSkeleton,
  RoleBadge,
  type CommunityPostAuthor,
  type CommunityPostConversation,
  type CommunityPostData,
  type CommunityPostProps,
  type CommunityPostVariant,
};
