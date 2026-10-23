import { type ScopedQueries } from "@cohory/db";
import { agentIdentities, memberships, postDrafts, posts, users } from "@cohory/db/schema";
import { asc, eq, isNotNull, isNull } from "drizzle-orm";

import type { PostsStore } from "../repository";

import {
  createPostQueries,
  postColumns,
  toPostRecord,
  authorColumns,
  staffRole,
  authorMembership,
  agentColumns,
  agentOf,
  toDraftRecord,
} from "./queries";

export function createDraftStore(
  queries: ScopedQueries,
): Pick<
  PostsStore,
  | "insertDraft"
  | "findDraft"
  | "listDrafts"
  | "deleteDraft"
  | "listScheduledPosts"
  | "reschedulePost"
  | "deleteScheduledPost"
  | "publishScheduledPost"
  | "discardScheduledPost"
> {
  const { tx, where, values } = queries;
  const { imagesFor, categoriesFor } = createPostQueries(queries);

  return {
    async insertDraft(draft) {
      await tx.insert(postDrafts).values(values({ ...draft, updatedAt: draft.createdAt }));
    },

    async findDraft(draftId) {
      const [row] = await tx
        .select()
        .from(postDrafts)
        .where(where(postDrafts, eq(postDrafts.id, draftId)))
        .limit(1);
      return row ? toDraftRecord(row) : null;
    },

    async listDrafts(authorId) {
      const rows = await tx
        .select({
          draft: postDrafts,
          authorName: users.name,
          authorImage: users.image,
          ...agentColumns,
        })
        .from(postDrafts)
        .innerJoin(users, eq(users.id, postDrafts.authorId))
        .leftJoin(agentIdentities, eq(agentIdentities.id, postDrafts.agentId))
        .where(where(postDrafts, authorId ? eq(postDrafts.authorId, authorId) : undefined))
        .orderBy(asc(postDrafts.createdAt), asc(postDrafts.id))
        .limit(100);
      const labels = await categoriesFor(rows.flatMap((row) => row.draft.categoryId ?? []));
      return rows.map((row) => ({
        ...toDraftRecord(row.draft),
        author: { id: row.draft.authorId, name: row.authorName, image: row.authorImage },
        agent: agentOf(row.draft.agentId, row.agentName),
        category: row.draft.categoryId ? (labels.get(row.draft.categoryId) ?? null) : null,
      }));
    },

    async deleteDraft(draftId) {
      await tx.delete(postDrafts).where(where(postDrafts, eq(postDrafts.id, draftId)));
    },

    async listScheduledPosts(authorId, limit) {
      const rows = await tx
        .select({ post: postColumns, ...authorColumns, ...agentColumns })
        .from(posts)
        .innerJoin(users, eq(users.id, posts.authorId))
        .leftJoin(memberships, authorMembership(posts.communityId, posts.authorId))
        .leftJoin(agentIdentities, eq(agentIdentities.id, posts.agentId))
        .where(
          where(
            posts,
            isNotNull(posts.scheduledAt),
            isNull(posts.deletedAt),
            authorId ? eq(posts.authorId, authorId) : undefined,
          ),
        )
        .orderBy(asc(posts.scheduledAt), asc(posts.id))
        .limit(limit);
      const images = await imagesFor(rows.map((row) => row.post.id));
      const labels = await categoriesFor(rows.flatMap((row) => row.post.categoryId ?? []));
      return rows.map((row) => ({
        ...toPostRecord(row.post),
        author: { id: row.post.authorId, name: row.authorName, image: row.authorImage },
        agent: agentOf(row.post.agentId, row.agentName),
        category: row.post.categoryId ? (labels.get(row.post.categoryId) ?? null) : null,
        authorRole: staffRole(row.authorRole),
        images: images.get(row.post.id) ?? [],
        viewerHasLiked: false,
        viewerFollows: false,
        conversation: null,
      }));
    },

    async reschedulePost(postId, scheduledAt) {
      await tx
        .update(posts)
        .set({ scheduledAt, updatedAt: new Date() })
        .where(where(posts, eq(posts.id, postId), isNotNull(posts.scheduledAt)));
    },

    async deleteScheduledPost(postId) {
      const rows = await tx
        .delete(posts)
        .where(
          where(posts, eq(posts.id, postId), isNotNull(posts.scheduledAt), isNull(posts.deletedAt)),
        )
        .returning({ id: posts.id });
      return rows.length > 0;
    },

    async publishScheduledPost(postId, at) {
      const rows = await tx
        .update(posts)
        .set({ scheduledAt: null, createdAt: at, lastActivityAt: at, updatedAt: at })
        .where(
          where(posts, eq(posts.id, postId), isNotNull(posts.scheduledAt), isNull(posts.deletedAt)),
        )
        .returning({ id: posts.id });
      return rows.length > 0;
    },

    async discardScheduledPost(postId, at) {
      const rows = await tx
        .update(posts)
        .set({ deletedAt: at, updatedAt: at })
        .where(
          where(posts, eq(posts.id, postId), isNotNull(posts.scheduledAt), isNull(posts.deletedAt)),
        )
        .returning({ id: posts.id });
      return rows.length > 0;
    },
  };
}
