import {
  getCommunityById,
  parseCommunityId,
  runInCommunity,
  setRlsFlag,
  withCommunity,
  type Database,
  type ScopedQueries,
} from "@cohory/db";
import { communities, posts } from "@cohory/db/schema";
import { and, asc, eq, lte, isNotNull, isNull } from "drizzle-orm";
import { createCategoryStore } from "./postgres/categories";
import { createCommentStore } from "./postgres/comments";
import { createDraftStore } from "./postgres/drafts";
import { createMemberStore } from "./postgres/members";
import { createPostStore } from "./postgres/posts";
import { createSearchStore } from "./postgres/search";

import { createReportsStore } from "./reports/postgres-store";
import type { PostsRepository, PostsStore } from "./repository";

function createStore(queries: ScopedQueries): PostsStore {
  return {
    reports: createReportsStore(queries),
    ...createMemberStore(queries),
    ...createPostStore(queries),
    ...createDraftStore(queries),
    ...createSearchStore(queries),
    ...createCategoryStore(queries),
    ...createCommentStore(queries),
  };
}

export function createPostgresPostsRepository(db: Database): PostsRepository {
  return {
    async findCommunity(communityId) {
      const community = await getCommunityById(db, communityId);
      return community
        ? { id: community.id, privacy: community.privacy, archivedAt: community.archivedAt }
        : null;
    },
    inCommunity(communityId, fn) {
      return runInCommunity(withCommunity(db, communityId), (queries) => fn(createStore(queries)));
    },
    listDueScheduledPosts(now, limit) {
      return db.transaction(async (tx) => {
        await setRlsFlag(tx, "posts_scheduler");
        const rows = await tx
          .select({ id: posts.id, communityId: posts.communityId, authorId: posts.authorId })
          .from(posts)
          .innerJoin(communities, eq(communities.id, posts.communityId))
          .where(
            and(
              isNotNull(posts.scheduledAt),
              isNull(posts.deletedAt),
              lte(posts.scheduledAt, now),
              isNull(communities.deletedAt),
            ),
          )
          .orderBy(asc(posts.scheduledAt), asc(posts.id))
          .limit(limit);
        return rows.map((row) => ({ ...row, communityId: parseCommunityId(row.communityId) }));
      });
    },
  };
}
