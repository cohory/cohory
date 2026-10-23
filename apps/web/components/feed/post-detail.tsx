"use client";

import {
  CommentComposer,
  CommentThread,
  LevelBadge,
  toast,
  type CommentThreadComment,
  type ItemAction,
} from "@cohory/ui";
import { Flag, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { createCommentAction, deleteCommentAction } from "../../lib/posts/actions";
import type { FeedComment, FeedPost } from "../../lib/posts/views";
import { mentionResolver } from "./client-helpers";
import { FollowButton } from "./follow-button";
import { ConfirmDialog } from "./confirm-dialog";
import { EditCommentDialog } from "./edit-comment-dialog";
import { EditPostForm } from "./edit-post-form";
import { PostCard } from "./post-card";
import { ReportDialog, type ReportTarget } from "./report-dialog";
import { useLikes } from "./use-like";

export interface PostDetailProps {
  slug: string;
  post: FeedPost;
  comments: FeedComment[];
  hasMoreComments: boolean;
  canComment: boolean;
  canLike: boolean;
  canFollow: boolean;
  signedIn: boolean;
  startEditing: boolean;
}

export function PostDetail({
  slug,
  post,
  comments,
  hasMoreComments,
  canComment,
  canLike,
  canFollow,
  signedIn,
  startEditing,
}: PostDetailProps) {
  const router = useRouter();
  const postDeleted = post.deletion !== null;
  const canReply = canComment && !postDeleted;
  const canEdit = post.actions.includes("edit");
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [editingComment, setEditingComment] = useState<FeedComment | null>(null);
  const [deletingComment, setDeletingComment] = useState<FeedComment | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [replyError, setReplyError] = useState<{ parentId: string; message: string }>();
  const [commentError, setCommentError] = useState<string | null>(null);
  const resolveMention = useMemo(() => mentionResolver(slug), [slug]);
  const likes = useLikes(
    slug,
    canLike,
    signedIn ? "Join this community to like posts." : "Sign in and join to like posts.",
  );

  async function comment(parentId: string | null, document: CommentThreadComment["content"]) {
    const result = await createCommentAction({ slug, postId: post.id, parentId, document });
    if (!result.ok) {
      if (parentId) setReplyError({ parentId, message: result.message });
      else setCommentError(result.message);
      throw new Error(result.message);
    }
    setReplyError(undefined);
    setCommentError(null);
    router.refresh();
  }

  function commentActions(item: FeedComment): ItemAction[] {
    const actions: ItemAction[] = [];
    if (item.permissions.edit) {
      actions.push({
        id: "edit",
        label: "Edit comment",
        icon: <Pencil aria-hidden="true" />,
        onSelect: () => setEditingComment(item),
      });
    }
    if (item.permissions.delete) {
      actions.push({
        id: "delete",
        label: "Delete comment",
        icon: <Trash2 aria-hidden="true" />,
        variant: "danger",
        onSelect: () => setDeletingComment(item),
      });
    }
    if (item.permissions.report) {
      actions.push({
        id: "report",
        label: "Report comment",
        icon: <Flag aria-hidden="true" />,
        onSelect: () => setReporting({ type: "comment", id: item.id }),
      });
    }
    return actions;
  }

  const threadComments = comments.map((item): CommentThreadComment => {
    const like = likes.read(item.id, { liked: item.likedByViewer, count: item.likeCount });
    return {
      id: item.id,
      parentId: item.parentId,
      author: { ...item.author, role: item.authorRole },
      levelBadge: item.author.level ? (
        <LevelBadge level={item.author.level.level} name={item.author.level.name} />
      ) : null,
      content: item.content,
      createdAt: item.createdAt,
      likeCount: like.count,
      likedByViewer: like.liked,
      actions: commentActions(item),
      status: item.deletion ? "deleted" : "visible",
      deletion: item.deletion,
    };
  });

  const postLike = likes.read(post.id, { liked: post.likedByViewer, count: post.likeCount });

  return (
    <div className="-mx-4 flex flex-col gap-6 md:mx-0">
      {editing ? (
        <EditPostForm
          slug={slug}
          post={post}
          resolveMention={resolveMention}
          onDone={(saved) => {
            setEditing(false);
            if (saved) {
              toast.success("Changes saved.");
              router.replace(`/c/${slug}/posts/${post.id}`);
              router.refresh();
            }
          }}
        />
      ) : (
        <PostCard
          slug={slug}
          post={post}
          variant="detail"
          like={postLike}
          onLike={() => likes.toggle("post", post.id, postLike)}
          onEdit={() => setEditing(true)}
          footerEnd={
            canFollow && !postDeleted ? (
              <FollowButton slug={slug} postId={post.id} following={post.viewerFollows} />
            ) : null
          }
          onDeleted={() => {
            router.push(`/c/${slug}`);
            router.refresh();
          }}
        />
      )}

      <section
        id="comments"
        aria-labelledby="comments-heading"
        className="flex flex-col gap-4 px-4 md:px-0"
      >
        <h2 id="comments-heading" className="text-lg font-semibold text-text">
          Comments
        </h2>
        {canReply && !editing ? (
          <CommentComposer
            label="Write a comment"
            placeholder="Write a comment"
            onResolveMention={resolveMention}
            error={commentError ?? undefined}
            onSubmit={(document) => comment(null, document)}
          />
        ) : null}
        {postDeleted ? (
          <p className="text-sm text-text-muted">This post was deleted, so no one can comment.</p>
        ) : null}
        {!canComment && !postDeleted ? (
          <p className="text-sm text-text-muted">
            {signedIn ? "Join this community to comment." : "Sign in and join to comment."}
          </p>
        ) : null}
        <CommentThread
          comments={threadComments}
          onLike={(id) => {
            const item = threadComments.find((entry) => entry.id === id);
            if (item) {
              likes.toggle("comment", id, { liked: item.likedByViewer, count: item.likeCount });
            }
          }}
          onReply={canReply ? ({ parentId, document }) => comment(parentId, document) : undefined}
          onResolveMention={resolveMention}
          replyError={replyError}
        />
        {hasMoreComments ? (
          <p className="text-sm text-text-muted">Showing the first 100 comment threads.</p>
        ) : null}
      </section>

      {editingComment ? (
        <EditCommentDialog
          slug={slug}
          comment={editingComment}
          resolveMention={resolveMention}
          onClose={(saved) => {
            setEditingComment(null);
            if (saved) {
              toast.success("Changes saved.");
              router.refresh();
            }
          }}
        />
      ) : null}
      <ReportDialog slug={slug} target={reporting} onClose={() => setReporting(null)} />
      <ConfirmDialog
        open={deletingComment !== null}
        onOpenChange={(open) => (open ? undefined : setDeletingComment(null))}
        title="Delete this comment?"
        description="Replies to this comment will be hidden too."
        confirmLabel="Delete comment"
        onConfirm={async () => {
          if (!deletingComment) return;
          const result = await deleteCommentAction({ slug, commentId: deletingComment.id });
          if (!result.ok) {
            toast.error(result.message);
            return;
          }
          setDeletingComment(null);
          toast.success("Comment deleted.");
          router.refresh();
        }}
      />
    </div>
  );
}
