import { assertCan, can, type Actor } from "@cohory/authz";

import { decodeCommentCursor, encodeCommentCursor } from "../cursor";
import { CommentNotFoundError, InvalidParentCommentError } from "../errors";
import type { PostEvent } from "../events";
import type { AuthorSummary, CommentRecord, CommentRow, PostsStore } from "../repository";
import {
  commentsPageSize,
  createCommentInputSchema,
  pageInputSchema,
  updateCommentInputSchema,
  type CreateCommentInput,
  type PageInput,
  type UpdateCommentInput,
} from "../schemas";
import { toCommentView, type CommentThreadView, type CommentView, type Page } from "../views";
import {
  isUuid,
  parseOrThrow,
  prepareContent,
  recordEvents,
  requireUserId,
  withAccess,
  withWriteAccess,
  type Access,
  type Recorded,
  type Runtime,
} from "./context";
import { isLivePost } from "./live";
import { agentIdOf, deletionOf, loadLivePost, loadPostForReader, type DeleteResult } from "./posts";
import { notificationPreview } from "./preview";
import { resolveReportsOnDelete } from "./reports";

export interface CreateCommentResult extends Recorded {
  readonly comment: CommentView;
  readonly mentionedUserIds: readonly string[];
}

async function loadLiveComment(store: PostsStore, commentId: string): Promise<CommentRecord> {
  const comment = isUuid(commentId) ? await store.findComment(commentId) : null;
  if (!comment || comment.deletedAt) {
    throw new CommentNotFoundError();
  }
  const post = await store.findPost(comment.postId);
  if (!isLivePost(post)) {
    throw new CommentNotFoundError();
  }
  return comment;
}

async function readCommentView(access: Access, commentId: string): Promise<CommentView> {
  const row = await access.store.getCommentRow(commentId, access.viewerId);
  if (!row || row.deletedAt) {
    throw new CommentNotFoundError();
  }
  return toCommentView(row);
}

export function createCommentOperations(runtime: Runtime) {
  return {
    async createComment(
      actor: Actor,
      communityId: string,
      postId: string,
      input: CreateCommentInput,
    ): Promise<CreateCommentResult> {
      const userId = requireUserId(actor);
      runtime.rateLimit("comment", userId);
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "create", "comment", access.policy());
        const post = await loadLivePost(access.store, postId);
        const { body, parentId } = parseOrThrow(createCommentInputSchema, input);
        const parent = parentId ? await access.store.findComment(parentId) : null;
        if (
          parentId &&
          (!parent || parent.deletedAt || parent.postId !== post.id || parent.parentId !== null)
        ) {
          throw new InvalidParentCommentError();
        }
        const prepared = await prepareContent(runtime, access, body, {
          allowImages: false,
          authorId: userId,
        });
        const id = runtime.newId();
        const createdAt = runtime.now();
        await access.store.insertComment({
          id,
          postId: post.id,
          authorId: userId,
          agentId: agentIdOf(actor),
          parentId: parentId ?? null,
          createdAt,
          ...prepared.content,
        });
        await access.store.adjustCommentCount(post.id, 1);
        await access.store.touchPostActivity(post.id, createdAt);
        if (userId !== post.authorId) {
          await access.store.followPost(post.id, userId, createdAt);
        }
        const base = { communityId: access.community.id, postId: post.id, authorId: userId };
        const preview = notificationPreview(null, prepared.content.bodyText);
        const events: PostEvent[] = [
          {
            type: "comment.created",
            payload: {
              ...base,
              commentId: id,
              parentId: parent?.id ?? null,
              parentAuthorId: parent?.authorId ?? null,
              agentId: agentIdOf(actor),
              postAuthorId: post.authorId,
              mentionedUserIds: prepared.mentionedUserIds,
              preview,
            },
          },
          ...prepared.mentionedUserIds.map((mentionedUserId): PostEvent => ({
            type: "mention.created",
            payload: { ...base, subjectType: "comment", subjectId: id, mentionedUserId, preview },
          })),
        ];
        return recordEvents(runtime, access, {
          comment: await readCommentView(access, id),
          mentionedUserIds: prepared.mentionedUserIds,
          events,
        });
      });
    },

    async updateComment(
      actor: Actor,
      communityId: string,
      commentId: string,
      input: UpdateCommentInput,
    ): Promise<CommentView> {
      const userId = requireUserId(actor);
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        const comment = await loadLiveComment(access.store, commentId);
        assertCan(actor, "edit", "comment", access.policy(comment.authorId === userId));
        const { body } = parseOrThrow(updateCommentInputSchema, input);
        const prepared = await prepareContent(runtime, access, body, {
          allowImages: false,
          authorId: userId,
        });
        await access.store.updateCommentContent(comment.id, {
          ...prepared.content,
          editedAt: runtime.now(),
        });
        return readCommentView(access, comment.id);
      });
    },

    async deleteComment(
      actor: Actor,
      communityId: string,
      commentId: string,
    ): Promise<DeleteResult> {
      const userId = requireUserId(actor);
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        const comment = await loadLiveComment(access.store, commentId);
        assertCan(actor, "delete", "comment", access.policy(comment.authorId === userId));
        const at = runtime.now();
        const hidden = await access.store.softDeleteCommentThread(comment.id, at, userId);
        await access.store.adjustCommentCount(comment.postId, -hidden.length);
        await resolveReportsOnDelete(
          { actor, access, userId, at },
          { type: "comment", commentId: comment.id, commentIds: hidden },
        );
        const likes = await access.store.listLikesOnComments(hidden);
        return recordEvents(runtime, access, {
          events: [
            {
              type: "comment.deleted",
              payload: {
                communityId: access.community.id,
                postId: comment.postId,
                commentId: comment.id,
                authorId: comment.authorId,
                occurredAt: at.toISOString(),
                likes,
              },
            },
          ],
        });
      });
    },

    async listComments(
      actor: Actor,
      communityId: string,
      postId: string,
      input: PageInput = {},
    ): Promise<Page<CommentThreadView>> {
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "read", "comment", access.policy());
        const post = await loadPostForReader(actor, access, postId);
        const includeDeleted = can(actor, "read_deleted", "comment", access.policy());
        const { cursor, limit = commentsPageSize } = parseOrThrow(pageInputSchema, input);
        const after = cursor ? decodeCommentCursor(cursor) : null;
        const rows = await access.store.listTopLevelComments(
          post.id,
          access.viewerId,
          after,
          limit + 1,
          includeDeleted,
        );
        const page = rows.slice(0, limit);
        const replies = page.length
          ? await access.store.listReplies(
              post.id,
              page.map((row) => row.id),
              access.viewerId,
              includeDeleted,
            )
          : [];
        const names = new Map<string, AuthorSummary | null>();
        const view = async (row: CommentRow): Promise<CommentView> =>
          toCommentView(row, await deletionOf(access.store, row, names));
        const data: CommentThreadView[] = [];
        for (const row of page) {
          const threadReplies: CommentView[] = [];
          for (const reply of replies.filter((candidate) => candidate.parentId === row.id)) {
            threadReplies.push(await view(reply));
          }
          data.push({ ...(await view(row)), replies: threadReplies });
        }
        const last = page.at(-1);
        return {
          data,
          nextCursor: rows.length > limit && last ? encodeCommentCursor(last) : null,
        };
      });
    },
  };
}
