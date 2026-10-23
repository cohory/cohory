import { assertCan, type Actor } from "@cohory/authz";
import { prefixTsQuery, splitHighlights, type ExcerptSegment } from "@cohory/db";

import type { PostSearchRow } from "../repository";
import { withAccess, type Runtime } from "./context";

export interface PostSearchHit {
  readonly postId: string;
  readonly commentId: string | null;
  readonly title: string | null;
  readonly excerpt: readonly ExcerptSegment[];
  readonly authorName: string;
  readonly createdAt: Date;
  readonly rank: number;
}

function toHit(row: PostSearchRow): PostSearchHit {
  return {
    postId: row.postId,
    commentId: row.commentId,
    title: row.title,
    excerpt: splitHighlights(row.headline),
    authorName: row.authorName,
    createdAt: row.createdAt,
    rank: row.rank,
  };
}

export function mergePostHits(
  postRows: readonly PostSearchRow[],
  commentRows: readonly PostSearchRow[],
  limit: number,
): PostSearchHit[] {
  const best = new Map<string, PostSearchRow>();
  for (const row of [...postRows, ...commentRows]) {
    const current = best.get(row.postId);
    if (!current || row.rank > current.rank) {
      best.set(row.postId, row);
    }
  }
  return [...best.values()]
    .sort((a, b) => b.rank - a.rank || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map(toHit);
}

export function createSearchOperations(runtime: Runtime) {
  return {
    async searchPosts(
      actor: Actor,
      communityId: string,
      query: string,
      limit: number,
      options: { readonly comments?: boolean } = {},
    ): Promise<PostSearchHit[]> {
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "read", "post", access.policy());
        const tsQuery = prefixTsQuery(query);
        if (!tsQuery) {
          return [];
        }
        const postRows = await access.store.searchPosts(tsQuery, limit);
        const commentRows =
          options.comments === false ? [] : await access.store.searchComments(tsQuery, limit);
        return mergePostHits(postRows, commentRows, limit);
      });
    },
  };
}
