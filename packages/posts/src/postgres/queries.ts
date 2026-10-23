import { setRlsValue, type ScopedQueries } from "@cohory/db";
import type { postDrafts } from "@cohory/db/schema";
import {
  agentIdentities,
  categories,
  comments,
  memberships,
  postFollows,
  postImages,
  posts,
  reactions,
  users,
} from "@cohory/db/schema";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  and,
  asc,
  eq,
  getTableColumns,
  desc,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { contentDocumentSchema } from "@cohory/content";
import { topCommentWeight } from "../cursor";
import type {
  CategoryRecord,
  CategorySummary,
  CommentCursor,
  CommentRecord,
  CommentRow,
  ConversationSummary,
  DraftRecord,
  FeedCursor,
  FeedSort,
  ImageRecord,
  PostRecord,
  PostRow,
  ReactionTarget,
  StaffRole,
} from "../repository";
import { recentCommentersLimit } from "../schemas";

function withoutSearchVector<T extends { searchVector: unknown }>(
  columns: T,
): Omit<T, "searchVector"> {
  return Object.fromEntries(
    Object.entries(columns).filter(([key]) => key !== "searchVector"),
  ) as Omit<T, "searchVector">;
}

export const postColumns = withoutSearchVector(getTableColumns(posts));
export const commentColumns = withoutSearchVector(getTableColumns(comments));

type PostSelect = Omit<typeof posts.$inferSelect, "searchVector">;
type CommentSelect = Omit<typeof comments.$inferSelect, "searchVector">;

export function toPostRecord(row: PostSelect): PostRecord {
  return { ...row, body: contentDocumentSchema.parse(row.body) };
}

export function toCommentRecord(row: CommentSelect): CommentRecord {
  return { ...row, body: contentDocumentSchema.parse(row.body) };
}

export const likeColumns = {
  reactionId: reactions.id,
  subjectAuthorId: reactions.subjectAuthorId,
  userId: reactions.userId,
};

export const authorColumns = {
  authorName: users.name,
  authorImage: users.image,
  authorRole: memberships.role,
};

export function staffRole(role: string | null): StaffRole | null {
  return role === "owner" || role === "admin" || role === "moderator" ? role : null;
}

export function authorMembership(communityId: AnyPgColumn, authorId: AnyPgColumn): SQL {
  return (
    and(
      eq(memberships.communityId, communityId),
      eq(memberships.userId, authorId),
      eq(memberships.status, "active"),
    ) ?? sql`false`
  );
}
export const agentColumns = { agentName: agentIdentities.name };

export function agentOf(agentId: string | null, agentName: string | null) {
  return agentId && agentName ? { id: agentId, name: agentName } : null;
}

type DraftSelect = typeof postDrafts.$inferSelect;

export function toDraftRecord(row: DraftSelect): DraftRecord {
  return { ...row, body: contentDocumentSchema.parse(row.body) };
}

function likedBy(
  subjectType: "post" | "comment",
  subjectId: AnyPgColumn,
  viewerId: string | null,
): SQL<boolean> {
  if (!viewerId) {
    return sql<boolean>`false`;
  }
  return sql<boolean>`exists (select 1 from ${reactions} where ${reactions.subjectType} = ${subjectType} and ${reactions.subjectId} = ${subjectId} and ${reactions.userId} = ${viewerId})`;
}

export const published = and(isNull(posts.deletedAt), isNull(posts.scheduledAt));

const topScoreSql = sql`(${posts.likeCount} + ${topCommentWeight} * ${posts.commentCount})`;

function feedOrder(sort: FeedSort): SQL[] {
  const pinned = sql`${posts.pinnedAt} desc nulls last`;
  switch (sort) {
    case "new":
      return [pinned, sql`${posts.createdAt} desc`, sql`${posts.id} desc`];
    case "active":
      return [pinned, sql`${posts.lastActivityAt} desc`, sql`${posts.id} desc`];
    case "top":
      return [
        pinned,
        sql`${topScoreSql} desc`,
        sql`${posts.createdAt} desc`,
        sql`${posts.id} desc`,
      ];
  }
}

function laterInGroup(cursor: FeedCursor): SQL {
  const at = cursor.at.toISOString();
  switch (cursor.sort) {
    case "new":
      return sql`(${posts.createdAt}, ${posts.id}) < (${at}::timestamptz, ${cursor.id}::uuid)`;
    case "active":
      return sql`(${posts.lastActivityAt}, ${posts.id}) < (${at}::timestamptz, ${cursor.id}::uuid)`;
    case "top":
      return sql`(${topScoreSql}, ${posts.createdAt}, ${posts.id}) < (${cursor.score ?? 0}::integer, ${at}::timestamptz, ${cursor.id}::uuid)`;
  }
}

export function feedAfter(cursor: FeedCursor): SQL {
  const olderInGroup = laterInGroup(cursor);
  if (!cursor.pinnedAt) {
    return and(isNull(posts.pinnedAt), olderInGroup) ?? sql`false`;
  }
  return (
    or(
      isNull(posts.pinnedAt),
      sql`${posts.pinnedAt} < ${cursor.pinnedAt}`,
      and(eq(posts.pinnedAt, cursor.pinnedAt), olderInGroup),
    ) ?? sql`false`
  );
}

export function requiredCategory(row: CategoryRecord | undefined): CategoryRecord {
  if (!row) {
    throw new Error("category write returned no row");
  }
  return row;
}

export function commentAfter(cursor: CommentCursor): SQL {
  return sql`(${comments.createdAt}, ${comments.id}) > (${cursor.createdAt}, ${cursor.id})`;
}

function followedBy(postId: AnyPgColumn, viewerId: string | null): SQL<boolean> {
  if (!viewerId) {
    return sql<boolean>`false`;
  }
  return sql<boolean>`exists (select 1 from ${postFollows} where ${postFollows.postId} = ${postId} and ${postFollows.userId} = ${viewerId})`;
}

export function createPostQueries(queries: ScopedQueries) {
  const { tx, where, values } = queries;
  async function actAs(userId: string | null): Promise<void> {
    if (userId) {
      await setRlsValue(tx, "user_id", userId);
    }
  }

  async function conversationsFor(
    postIds: readonly string[],
  ): Promise<Map<string, ConversationSummary>> {
    const byPost = new Map<string, ConversationSummary>();
    if (postIds.length === 0) {
      return byPost;
    }
    const lastAt = sql<Date>`max(${comments.createdAt})`.mapWith(comments.createdAt);
    const rows = await tx
      .select({
        postId: comments.postId,
        id: comments.authorId,
        name: users.name,
        image: users.image,
        at: lastAt,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(where(comments, inArray(comments.postId, [...postIds]), isNull(comments.deletedAt)))
      .groupBy(comments.postId, comments.authorId, users.name, users.image)
      .orderBy(asc(comments.postId), desc(lastAt));
    for (const { postId, at, ...commenter } of rows) {
      const current = byPost.get(postId);
      if (!current) {
        byPost.set(postId, { recentCommenters: [commenter], lastCommentAt: at });
      } else if (current.recentCommenters.length < recentCommentersLimit) {
        byPost.set(postId, {
          ...current,
          recentCommenters: [...current.recentCommenters, commenter],
        });
      }
    }
    return byPost;
  }

  async function imagesFor(postIds: readonly string[]): Promise<Map<string, ImageRecord[]>> {
    const byPost = new Map<string, ImageRecord[]>();
    if (postIds.length === 0) {
      return byPost;
    }
    const rows = await tx
      .select({
        postId: postImages.postId,
        key: postImages.storageKey,
        width: postImages.width,
        height: postImages.height,
        position: postImages.position,
      })
      .from(postImages)
      .where(where(postImages, inArray(postImages.postId, [...postIds])))
      .orderBy(asc(postImages.postId), asc(postImages.position));
    for (const { postId, ...image } of rows) {
      byPost.set(postId, [...(byPost.get(postId) ?? []), image]);
    }
    return byPost;
  }

  async function categoriesFor(ids: readonly string[]): Promise<Map<string, CategorySummary>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      return new Map();
    }
    const rows = await tx
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
        color: categories.color,
      })
      .from(categories)
      .where(where(categories, inArray(categories.id, unique)));
    return new Map(rows.map((row) => [row.id, row]));
  }

  async function insertImages(postId: string, images: readonly ImageRecord[]): Promise<void> {
    if (images.length > 0) {
      await tx.insert(postImages).values(
        images.map((image) =>
          values({
            postId,
            storageKey: image.key,
            width: image.width,
            height: image.height,
            position: image.position,
          }),
        ),
      );
    }
  }

  async function selectPostRows(
    viewerId: string | null,
    condition: SQL,
    limit: number,
    sort: FeedSort = "new",
  ): Promise<PostRow[]> {
    await actAs(viewerId);
    const rows = await tx
      .select({
        post: postColumns,
        ...authorColumns,
        ...agentColumns,
        liked: likedBy("post", posts.id, viewerId),
        following: followedBy(posts.id, viewerId),
      })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .leftJoin(memberships, authorMembership(posts.communityId, posts.authorId))
      .leftJoin(agentIdentities, eq(agentIdentities.id, posts.agentId))
      .where(where(posts, condition))
      .orderBy(...feedOrder(sort))
      .limit(limit);
    const ids = rows.map((row) => row.post.id);
    const images = await imagesFor(ids);
    const conversations = await conversationsFor(ids);
    const labels = await categoriesFor(rows.flatMap((row) => row.post.categoryId ?? []));
    return rows.map((row) => ({
      ...toPostRecord(row.post),
      author: { id: row.post.authorId, name: row.authorName, image: row.authorImage },
      authorRole: staffRole(row.authorRole),
      agent: agentOf(row.post.agentId, row.agentName),
      category: row.post.categoryId ? (labels.get(row.post.categoryId) ?? null) : null,
      images: images.get(row.post.id) ?? [],
      viewerHasLiked: row.liked,
      viewerFollows: row.following,
      conversation: conversations.get(row.post.id) ?? null,
    }));
  }

  async function selectCommentRows(
    viewerId: string | null,
    condition: SQL,
    limit?: number,
  ): Promise<CommentRow[]> {
    const query = tx
      .select({
        comment: commentColumns,
        ...authorColumns,
        ...agentColumns,
        liked: likedBy("comment", comments.id, viewerId),
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .leftJoin(memberships, authorMembership(comments.communityId, comments.authorId))
      .leftJoin(agentIdentities, eq(agentIdentities.id, comments.agentId))
      .where(where(comments, condition))
      .orderBy(asc(comments.createdAt), asc(comments.id));
    const rows = await (limit === undefined ? query : query.limit(limit));
    return rows.map((row) => ({
      ...toCommentRecord(row.comment),
      author: { id: row.comment.authorId, name: row.authorName, image: row.authorImage },
      authorRole: staffRole(row.authorRole),
      agent: agentOf(row.comment.agentId, row.agentName),
      viewerHasLiked: row.liked,
    }));
  }

  function subjectTable(target: ReactionTarget) {
    return target.subjectType === "post" ? posts : comments;
  }

  return {
    actAs,
    conversationsFor,
    imagesFor,
    categoriesFor,
    insertImages,
    selectPostRows,
    selectCommentRows,
    subjectTable,
  };
}
