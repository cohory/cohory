import { type ScopedQueries } from "@cohory/db";
import { communities, memberships, postFollows, postImages, posts } from "@cohory/db/schema";
import { and, count, eq, gte, lte, isNotNull, isNull, or, sql } from "drizzle-orm";

import type { PostsStore } from "../repository";

import { createPostQueries, postColumns, toPostRecord, published, feedAfter } from "./queries";

export function createPostStore(
  queries: ScopedQueries,
): Pick<
  PostsStore,
  | "insertPost"
  | "findPost"
  | "getPostRow"
  | "updatePostContent"
  | "softDeletePost"
  | "lockPins"
  | "countPinned"
  | "setPinnedAt"
  | "listFeed"
  | "findFeedVisit"
  | "recordFeedVisit"
  | "followPost"
  | "unfollowPost"
  | "findMemberEmail"
  | "claimMemberEmail"
  | "updatePostCategory"
> {
  const { tx, where, values, communityId } = queries;
  const { actAs, insertImages, selectPostRows } = createPostQueries(queries);

  return {
    async insertPost(post, images) {
      await tx
        .insert(posts)
        .values(values({ ...post, updatedAt: post.createdAt, lastActivityAt: post.createdAt }));
      await insertImages(post.id, images);
    },

    async findPost(postId) {
      const [row] = await tx
        .select(postColumns)
        .from(posts)
        .where(where(posts, eq(posts.id, postId)))
        .limit(1);
      return row ? toPostRecord(row) : null;
    },

    async getPostRow(postId, viewerId) {
      const [row] = await selectPostRows(viewerId, eq(posts.id, postId), 1);
      return row ?? null;
    },

    async updatePostContent(postId, patch, images) {
      await tx
        .update(posts)
        .set(patch)
        .where(where(posts, eq(posts.id, postId)));
      if (images) {
        await tx.delete(postImages).where(where(postImages, eq(postImages.postId, postId)));
        await insertImages(postId, images);
      }
    },

    async softDeletePost(postId, at, by) {
      await tx
        .update(posts)
        .set({ deletedAt: at, deletedBy: by })
        .where(where(posts, eq(posts.id, postId)));
    },

    async lockPins() {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`cohory.posts.pins:${communityId}`}, 0))`,
      );
    },

    async countPinned() {
      const [row] = await tx
        .select({ value: count() })
        .from(posts)
        .where(where(posts, isNotNull(posts.pinnedAt), published));
      return row?.value ?? 0;
    },

    async setPinnedAt(postId, pinnedAt) {
      await tx
        .update(posts)
        .set({ pinnedAt })
        .where(where(posts, eq(posts.id, postId)));
    },

    async listFeed(viewerId, query) {
      const condition = and(
        published,
        query.categoryId ? eq(posts.categoryId, query.categoryId) : undefined,
        query.sort === "top"
          ? or(isNotNull(posts.pinnedAt), gte(posts.createdAt, query.topSince))
          : undefined,
        query.after ? feedAfter(query.after) : undefined,
      );
      return selectPostRows(viewerId, condition ?? sql`false`, query.limit, query.sort);
    },

    async findFeedVisit(userId) {
      const [row] = await tx
        .select({ at: memberships.lastFeedVisitAt })
        .from(memberships)
        .where(
          where(memberships, eq(memberships.userId, userId), eq(memberships.status, "active")),
        );
      return row?.at ?? null;
    },

    async recordFeedVisit(userId, at) {
      await tx
        .update(memberships)
        .set({ lastFeedVisitAt: at })
        .where(
          where(memberships, eq(memberships.userId, userId), eq(memberships.status, "active")),
        );
    },

    async followPost(postId, userId, at) {
      await actAs(userId);
      await tx
        .insert(postFollows)
        .values(values({ postId, userId, createdAt: at }))
        .onConflictDoNothing();
    },

    async unfollowPost(postId, userId) {
      await actAs(userId);
      await tx
        .delete(postFollows)
        .where(where(postFollows, eq(postFollows.postId, postId), eq(postFollows.userId, userId)));
    },

    async findMemberEmail() {
      const [row] = await tx
        .select({ sentAt: communities.memberEmailSentAt, sentBy: communities.memberEmailSentBy })
        .from(communities)
        .where(eq(communities.id, communityId));
      return row?.sentAt ? { sentAt: row.sentAt, sentBy: row.sentBy } : null;
    },

    async claimMemberEmail(at, by, since) {
      const rows = await tx
        .update(communities)
        .set({ memberEmailSentAt: at, memberEmailSentBy: by })
        .where(
          and(
            eq(communities.id, communityId),
            or(isNull(communities.memberEmailSentAt), lte(communities.memberEmailSentAt, since)),
          ),
        )
        .returning({ id: communities.id });
      return rows.length > 0;
    },

    async updatePostCategory(postId, categoryId) {
      await tx
        .update(posts)
        .set({ categoryId })
        .where(where(posts, eq(posts.id, postId)));
    },
  };
}
