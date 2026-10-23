import { headlineOptions, tsQuery, type ScopedQueries } from "@cohory/db";
import { comments, posts, users } from "@cohory/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { PostsStore } from "../repository";

import { published } from "./queries";

export function createSearchStore(
  queries: ScopedQueries,
): Pick<PostsStore, "searchPosts" | "searchComments"> {
  const { tx, where } = queries;

  return {
    searchPosts(query, limit) {
      const q = tsQuery(query);
      const rank = sql<number>`ts_rank(${posts.searchVector}, ${q})`.mapWith(Number);
      return tx
        .select({
          postId: posts.id,
          commentId: sql<string | null>`null::uuid`,
          title: posts.title,
          headline: sql<string>`ts_headline('simple', ${posts.bodyText}, ${q}, ${headlineOptions})`,
          rank,
          authorName: users.name,
          createdAt: posts.createdAt,
        })
        .from(posts)
        .innerJoin(users, eq(users.id, posts.authorId))
        .where(where(posts, published, sql`${posts.searchVector} @@ ${q}`))
        .orderBy(sql`${rank} desc`, sql`${posts.createdAt} desc`, sql`${posts.id} desc`)
        .limit(limit);
    },

    searchComments(query, limit) {
      const q = tsQuery(query);
      const rank = sql<number>`ts_rank(${comments.searchVector}, ${q})`.mapWith(Number);
      return tx
        .select({
          postId: comments.postId,
          commentId: sql<string | null>`${comments.id}`,
          title: posts.title,
          headline: sql<string>`ts_headline('simple', ${comments.bodyText}, ${q}, ${headlineOptions})`,
          rank,
          authorName: users.name,
          createdAt: comments.createdAt,
        })
        .from(comments)
        .innerJoin(
          posts,
          and(eq(posts.id, comments.postId), eq(posts.communityId, comments.communityId)),
        )
        .innerJoin(users, eq(users.id, comments.authorId))
        .where(
          where(
            comments,
            isNull(comments.deletedAt),
            published,
            sql`${comments.searchVector} @@ ${q}`,
          ),
        )
        .orderBy(sql`${rank} desc`, sql`${comments.createdAt} desc`, sql`${comments.id} desc`)
        .limit(limit);
    },
  };
}
