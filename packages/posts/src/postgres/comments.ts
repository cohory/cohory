import { type ScopedQueries } from "@cohory/db";
import { comments, posts, reactions } from "@cohory/db/schema";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { PostsStore } from "../repository";

import {
  createPostQueries,
  commentColumns,
  toCommentRecord,
  likeColumns,
  commentAfter,
} from "./queries";

export function createCommentStore(
  queries: ScopedQueries,
): Pick<
  PostsStore,
  | "insertComment"
  | "findComment"
  | "getCommentRow"
  | "updateCommentContent"
  | "softDeleteCommentThread"
  | "listLikesOnPost"
  | "listLikesOnComments"
  | "touchPostActivity"
  | "adjustCommentCount"
  | "listTopLevelComments"
  | "listReplies"
  | "addReaction"
  | "removeReaction"
  | "adjustLikeCount"
  | "readLikeCount"
> {
  const { tx, where, values } = queries;
  const { selectCommentRows, subjectTable } = createPostQueries(queries);

  return {
    async insertComment(comment) {
      await tx.insert(comments).values(values({ ...comment, updatedAt: comment.createdAt }));
    },

    async findComment(commentId) {
      const [row] = await tx
        .select(commentColumns)
        .from(comments)
        .where(where(comments, eq(comments.id, commentId)))
        .limit(1);
      return row ? toCommentRecord(row) : null;
    },

    async getCommentRow(commentId, viewerId) {
      const [row] = await selectCommentRows(viewerId, eq(comments.id, commentId), 1);
      return row ?? null;
    },

    async updateCommentContent(commentId, patch) {
      await tx
        .update(comments)
        .set(patch)
        .where(where(comments, eq(comments.id, commentId)));
    },

    async softDeleteCommentThread(commentId, at, by) {
      const rows = await tx
        .update(comments)
        .set({ deletedAt: at, deletedBy: by })
        .where(
          where(
            comments,
            or(eq(comments.id, commentId), eq(comments.parentId, commentId)),
            isNull(comments.deletedAt),
          ),
        )
        .returning({ id: comments.id });
      return rows.map((row) => row.id);
    },

    async listLikesOnPost(postId) {
      const liveComments = tx
        .select({ id: comments.id })
        .from(comments)
        .where(where(comments, eq(comments.postId, postId), isNull(comments.deletedAt)));
      return tx
        .select(likeColumns)
        .from(reactions)
        .where(
          where(
            reactions,
            or(
              and(eq(reactions.subjectType, "post"), eq(reactions.subjectId, postId)),
              and(eq(reactions.subjectType, "comment"), inArray(reactions.subjectId, liveComments)),
            ),
          ),
        );
    },

    async listLikesOnComments(commentIds) {
      if (commentIds.length === 0) {
        return [];
      }
      return tx
        .select(likeColumns)
        .from(reactions)
        .where(
          where(
            reactions,
            eq(reactions.subjectType, "comment"),
            inArray(reactions.subjectId, [...commentIds]),
          ),
        );
    },

    async touchPostActivity(postId, at) {
      await tx
        .update(posts)
        .set({
          lastActivityAt: sql`greatest(${posts.lastActivityAt}, ${at.toISOString()}::timestamptz)`,
        })
        .where(where(posts, eq(posts.id, postId)));
    },

    async adjustCommentCount(postId, delta) {
      await tx
        .update(posts)
        .set({ commentCount: sql`${posts.commentCount} + ${delta}` })
        .where(where(posts, eq(posts.id, postId)));
    },

    async listTopLevelComments(postId, viewerId, after, limit, includeDeleted = false) {
      const condition = and(
        eq(comments.postId, postId),
        isNull(comments.parentId),
        includeDeleted ? undefined : isNull(comments.deletedAt),
        after ? commentAfter(after) : undefined,
      );
      return selectCommentRows(viewerId, condition ?? sql`false`, limit);
    },

    async listReplies(postId, parentIds, viewerId, includeDeleted = false) {
      if (parentIds.length === 0) {
        return [];
      }
      const condition = and(
        eq(comments.postId, postId),
        inArray(comments.parentId, [...parentIds]),
        includeDeleted ? undefined : isNull(comments.deletedAt),
      );
      return selectCommentRows(viewerId, condition ?? sql`false`);
    },

    async addReaction(target, userId, subjectAuthorId) {
      const rows = await tx
        .insert(reactions)
        .values(values({ ...target, userId, subjectAuthorId, kind: "like" }))
        .onConflictDoNothing()
        .returning({ id: reactions.id });
      return rows[0]?.id ?? null;
    },

    async removeReaction(target, userId) {
      const rows = await tx
        .delete(reactions)
        .where(
          where(
            reactions,
            eq(reactions.subjectType, target.subjectType),
            eq(reactions.subjectId, target.subjectId),
            eq(reactions.userId, userId),
          ),
        )
        .returning({ id: reactions.id });
      return rows[0]?.id ?? null;
    },

    async adjustLikeCount(target, delta) {
      const table = subjectTable(target);
      const [row] = await tx
        .update(table)
        .set({ likeCount: sql`${table.likeCount} + ${delta}` })
        .where(where(table, eq(table.id, target.subjectId)))
        .returning({ likeCount: table.likeCount });
      return row?.likeCount ?? 0;
    },

    async readLikeCount(target) {
      const table = subjectTable(target);
      const [row] = await tx
        .select({ likeCount: table.likeCount })
        .from(table)
        .where(where(table, eq(table.id, target.subjectId)))
        .limit(1);
      return row?.likeCount ?? 0;
    },
  };
}
