"use client";

import { CommunityPost, LevelBadge, toast, type ItemAction } from "@cohory/ui";
import { Flag, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { deletePostAction, pinPostAction } from "../../lib/posts/actions";
import type { PostActionId } from "../../lib/posts/permissions";
import type { FeedPost } from "../../lib/posts/views";
import { ConfirmDialog } from "./confirm-dialog";
import { ReportDialog, type ReportTarget } from "./report-dialog";
import type { LikeState } from "./use-like";

export interface PostCardProps {
  slug: string;
  post: FeedPost;
  isNew?: boolean;
  variant: "feed" | "detail";
  like: LikeState;
  onLike(): void;
  onEdit?(): void;
  editHref?: string;
  onDeleted(): void;
  footerEnd?: ReactNode;
}

const icons: Record<PostActionId, ItemAction["icon"]> = {
  edit: <Pencil aria-hidden="true" />,
  pin: <Pin aria-hidden="true" />,
  unpin: <PinOff aria-hidden="true" />,
  delete: <Trash2 aria-hidden="true" />,
  report: <Flag aria-hidden="true" />,
};

const labels: Record<PostActionId, string> = {
  edit: "Edit post",
  pin: "Pin to top",
  unpin: "Unpin",
  delete: "Delete post",
  report: "Report post",
};

export function PostCard({
  slug,
  post,
  isNew = false,
  variant,
  like,
  onLike,
  onEdit = () => undefined,
  editHref,
  onDeleted,
  footerEnd,
}: PostCardProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [pending, startTransition] = useTransition();
  const href = `/c/${slug}/posts/${post.id}`;

  function pin(pinned: boolean) {
    startTransition(async () => {
      const result = await pinPostAction({ slug, postId: post.id, pinned });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(pinned ? "Post pinned." : "Post unpinned.");
      router.refresh();
    });
  }

  const handlers: Record<PostActionId, () => void> = {
    edit: onEdit,
    pin: () => pin(true),
    unpin: () => pin(false),
    delete: () => setConfirming(true),
    report: () => setReporting({ type: "post", id: post.id }),
  };

  const actions = post.actions.map((id): ItemAction => ({
    id,
    label: labels[id],
    icon: icons[id],
    onSelect: handlers[id],
    ...(id === "edit" && editHref ? { href: editHref } : {}),
    disabled: pending,
    ...(id === "delete" ? { variant: "danger" as const } : {}),
  }));

  return (
    <>
      <CommunityPost
        variant={variant}
        post={{
          id: post.id,
          title: post.title,
          category: post.category?.name ?? null,
          content: post.content,
          createdAt: post.createdAt,
          pinned: post.pinned,
          status: post.deletion ? "deleted" : "visible",
          deletion: post.deletion,
          isNew,
          conversation: post.conversation,
        }}
        author={{ ...post.author, role: post.authorRole }}
        levelBadge={
          post.author.level ? (
            <LevelBadge level={post.author.level.level} name={post.author.level.name} />
          ) : null
        }
        likeCount={like.count}
        likedByViewer={like.liked}
        commentCount={post.commentCount}
        onLike={onLike}
        href={variant === "feed" ? href : undefined}
        commentsHref={variant === "feed" ? href : "#comments"}
        actions={actions}
        footerEnd={footerEnd}
      />
      <ReportDialog slug={slug} target={reporting} onClose={() => setReporting(null)} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this post?"
        description="The post and its comments will no longer be visible to members."
        confirmLabel="Delete post"
        onConfirm={async () => {
          const result = await deletePostAction({ slug, postId: post.id });
          if (!result.ok) {
            toast.error(result.message);
            return;
          }
          setConfirming(false);
          toast.success("Post deleted.");
          onDeleted();
        }}
      />
    </>
  );
}
