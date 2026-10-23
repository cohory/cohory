"use client";

import {
  Button,
  CategoryChips,
  PostComposer,
  toast,
  type CategoryChip,
  type PostComposerCategory,
} from "@cohory/ui";
import { draftKey } from "@cohory/ui/lib/use-draft-autosave";
import { CalendarClock, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";

import {
  createPostAction,
  loadFeedPageAction,
  recordFeedVisitAction,
} from "../../lib/posts/actions";
import { isNewSince, type FeedPost } from "../../lib/posts/views";
import { EmptyState } from "../empty-state";
import type { MemberEmailState } from "../../lib/posts/load";
import { mentionResolver, mentionSearch, scheduledToast, uploadPostImage } from "./client-helpers";
import { PostCard } from "./post-card";
import { useLikes } from "./use-like";

export interface CommunityFeedProps {
  slug: string;
  category: string | null;
  sort: "active" | "new" | "top";
  sortControl?: ReactNode;
  chips: readonly CategoryChip[];
  composerCategories: readonly PostComposerCategory[];
  defaultCategoryId: string | null;
  composerPlaceholder?: string;
  composerOpen?: boolean;
  editCategoriesHref: string | null;
  staffOnlyCategory?: string | null;
  initialPosts: FeedPost[];
  initialCursor: string | null;
  canPost: boolean;
  memberEmail: MemberEmailState | null;
  lastVisitAt: string | null;
  scheduledCount: number;
  canLike: boolean;
  signedIn: boolean;
  viewer: { name: string; avatarUrl: string | null } | null;
}

export function CommunityFeed({
  slug,
  category,
  sort,
  sortControl,
  chips,
  composerCategories,
  defaultCategoryId,
  composerPlaceholder,
  composerOpen = false,
  editCategoriesHref,
  staffOnlyCategory = null,
  initialPosts,
  initialCursor,
  canPost,
  memberEmail,
  lastVisitAt,
  scheduledCount,
  canLike,
  signedIn,
  viewer,
}: CommunityFeedProps) {
  const router = useRouter();
  const [since] = useState(lastVisitAt);
  const [more, setMore] = useState<FeedPost[]>([]);
  const [loadedCursor, setLoadedCursor] = useState<string | null | undefined>(undefined);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const likes = useLikes(
    slug,
    canLike,
    signedIn ? "Join this community to like posts." : "Sign in and join to like posts.",
  );
  const resolveMention = useMemo(() => mentionResolver(slug), [slug]);
  const searchMentions = useMemo(() => mentionSearch(slug), [slug]);

  useEffect(() => {
    if (signedIn) void recordFeedVisitAction({ slug });
  }, [signedIn, slug]);

  const cursor = loadedCursor === undefined ? initialCursor : loadedCursor;
  const firstIds = new Set(initialPosts.map((post) => post.id));
  const posts = [...initialPosts, ...more.filter((post) => !firstIds.has(post.id))].filter(
    (post) => !hidden.has(post.id),
  );

  function loadMore() {
    if (!cursor) return;
    setStatus("Loading more posts");
    startLoading(async () => {
      const result = await loadFeedPageAction({
        slug,
        cursor,
        category,
        sort,
      });
      if (!result.ok) {
        setStatus("");
        toast.error(result.message);
        return;
      }
      setMore((current) => [...current, ...result.data.posts]);
      setLoadedCursor(result.data.nextCursor);
      const count = result.data.posts.length;
      setStatus(count === 1 ? "Loaded 1 more post" : `Loaded ${count} more posts`);
    });
  }

  return (
    <div className="-mx-4 flex flex-col gap-4 md:mx-0">
      <h2 className="sr-only">Posts</h2>
      {sortControl}
      {chips.length > 0 || editCategoriesHref ? (
        <div className="flex flex-wrap items-center gap-2 px-4 md:px-0">
          {chips.length > 0 ? <CategoryChips chips={chips} className="max-w-full" /> : null}
          {editCategoriesHref ? (
            <Link
              href={editCategoriesHref}
              className="inline-flex min-h-11 items-center rounded-sm px-2 text-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Edit categories
            </Link>
          ) : null}
        </div>
      ) : null}
      {staffOnlyCategory ? (
        <p className="px-4 text-sm text-text-muted md:px-0">
          Only staff can post in {staffOnlyCategory}. Everyone can read and comment.
        </p>
      ) : null}
      {canPost ? (
        <PostComposer
          draftKey={draftKey("post", slug)}
          allowSchedule
          categories={composerCategories}
          defaultCategoryId={defaultCategoryId}
          placeholder={composerPlaceholder}
          defaultExpanded={composerOpen}
          viewer={viewer ?? undefined}
          error={composerError}
          onUploadImage={(file) => uploadPostImage(slug, file)}
          onResolveMention={resolveMention}
          onSearchMentions={searchMentions}
          memberEmail={memberEmail}
          onSubmit={async ({ title, document, categoryId, scheduledAt, emailMembers }) => {
            setComposerError(null);
            const result = await createPostAction({
              slug,
              title,
              document,
              categoryId,
              scheduledAt,
              emailMembers,
            });
            if (!result.ok) {
              setComposerError(result.message);
              throw new Error(result.message);
            }
            if (result.data.scheduled && scheduledAt) {
              toast.success(scheduledToast(new Date(scheduledAt)), {
                action: {
                  label: "View",
                  onClick: () => router.push(`/c/${slug}/posts/scheduled`),
                },
              });
            } else if (result.data.emailFailure) {
              toast.error(`Posted, but the email didn't go out. ${result.data.emailFailure}`);
            } else {
              toast.success(emailMembers ? "Posted. Members get it by email." : "Posted.");
            }
            router.refresh();
          }}
        />
      ) : null}
      {canPost && scheduledCount > 0 ? (
        <div className="px-4 md:px-0">
          <Link
            href={`/c/${slug}/posts/scheduled`}
            className="inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CalendarClock aria-hidden="true" className="size-4" />
            {scheduledCount === 1 ? "1 scheduled post" : `${scheduledCount} scheduled posts`}
          </Link>
        </div>
      ) : null}
      {posts.length === 0 ? (
        <div className="px-4 md:px-0">
          {sort === "top" || category ? (
            <EmptyState
              icon={MessagesSquare}
              title={sort === "top" ? "No posts this week" : "No posts in this category yet"}
            >
              {sort === "top"
                ? "Top shows posts from the last 7 days."
                : "Posts in this category will show up here."}
            </EmptyState>
          ) : (
            <EmptyState icon={MessagesSquare} title="No posts yet">
              {canPost
                ? "Be the first to say hello."
                : "Posts from this community will show up here."}
            </EmptyState>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Posts">
          {posts.map((post) => (
            <li key={post.id}>
              <PostCard
                slug={slug}
                post={post}
                isNew={isNewSince(post, since)}
                variant="feed"
                like={likes.read(post.id, { liked: post.likedByViewer, count: post.likeCount })}
                onLike={() =>
                  likes.toggle(
                    "post",
                    post.id,
                    likes.read(post.id, { liked: post.likedByViewer, count: post.likeCount }),
                  )
                }
                editHref={`/c/${slug}/posts/${post.id}?edit=1`}
                onDeleted={() => setHidden((current) => new Set(current).add(post.id))}
              />
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <div className="flex justify-center px-4 md:px-0">
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={loading}
            aria-busy={loading}
            onClick={loadMore}
          >
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </div>
  );
}
