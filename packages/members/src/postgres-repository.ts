import {
  getCommunityById,
  headlineOptions,
  isUniqueViolation,
  tsQuery,
  runInCommunity,
  withCommunity,
  type CommunityId,
  type Database,
} from "@cohory/db";
import { getCommunityAccess } from "@cohory/entitlements/access";
import { comments, memberStats, memberships, posts, users } from "@cohory/db/schema";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

import type { MemberCursor, MembersRepository } from "./repository";

const joinedAt = sql<Date>`coalesce(${memberships.joinedAt}, ${memberships.createdAt})`;
const level = sql<number>`coalesce(${memberStats.level}, 1)::integer`;

const memberColumns = {
  membershipId: memberships.id,
  userId: memberships.userId,
  name: users.name,
  image: users.image,
  username: users.username,
  role: memberships.role,
  joinedAt: sql<Date>`${joinedAt}`.mapWith(memberships.createdAt),
  points: sql<number>`coalesce(${memberStats.pointsTotal}, 0)`.mapWith(Number),
  level: level.mapWith(Number),
  bio: memberships.bio,
};

function prefix(query: string): string {
  return `${query.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function matches(query: string): SQL {
  const pattern = prefix(query);
  return sql`(lower(${users.name}) like ${pattern} or lower(${users.username}::text) like ${pattern})`;
}

function after(cursor: MemberCursor): SQL {
  return sql`(${joinedAt}, ${memberships.id}) < (${cursor.joinedAt.toISOString()}::timestamptz, ${cursor.membershipId}::uuid)`;
}

export function createPostgresMembersRepository(db: Database): MembersRepository {
  function scoped<T>(
    communityId: CommunityId,
    fn: Parameters<typeof runInCommunity<T>>[1],
  ): Promise<T> {
    return runInCommunity(withCommunity(db, communityId), fn);
  }

  return {
    async findCommunity(communityId) {
      const community = await getCommunityById(db, communityId);
      return community
        ? {
            id: community.id,
            privacy: community.privacy,
            gamificationEnabled: community.gamificationEnabled,
            levelNames: community.levelNames,
          }
        : null;
    },

    findAccess(communityId, userId) {
      return getCommunityAccess(withCommunity(db, communityId), userId, new Date());
    },

    fullTextSearch(communityId, query, limit) {
      const q = tsQuery(query);
      const nameVector = sql`to_tsvector('simple', ${users.name} || ' ' || coalesce(${users.username}::text, ''))`;
      const bioVector = sql`to_tsvector('simple', coalesce(${memberships.bio}, ''))`;
      const rank =
        sql<number>`(2 * ts_rank(${nameVector}, ${q}) + ts_rank(${bioVector}, ${q}))`.mapWith(
          Number,
        );
      return scoped(communityId, ({ tx, where }) => {
        const matched = sql`(
          select m.id from memberships m join users u on u.id = m.user_id
          where m.community_id = ${communityId}
            and to_tsvector('simple', u.name || ' ' || coalesce(u.username::text, '')) @@ ${q}
          union
          select m.id from memberships m
          where m.community_id = ${communityId}
            and to_tsvector('simple', coalesce(m.bio, '')) @@ ${q}
        )`;
        return tx
          .select({
            userId: memberships.userId,
            name: users.name,
            username: users.username,
            image: users.image,
            bioHeadline: sql<
              string | null
            >`case when ${bioVector} @@ ${q} then ts_headline('simple', ${memberships.bio}, ${q}, ${headlineOptions}) end`,
            rank,
          })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(
            where(
              memberships,
              eq(memberships.status, "active"),
              sql`${memberships.id} in ${matched}`,
            ),
          )
          .orderBy(sql`${rank} desc`, sql`${users.name} asc`, sql`${memberships.id} asc`)
          .limit(limit);
      });
    },

    searchMembers(communityId, search) {
      return scoped(communityId, ({ tx, where }) =>
        tx
          .select(memberColumns)
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .leftJoin(
            memberStats,
            and(
              eq(memberStats.communityId, memberships.communityId),
              eq(memberStats.userId, memberships.userId),
            ),
          )
          .where(
            where(
              memberships,
              eq(memberships.status, "active"),
              search.query ? matches(search.query) : undefined,
              search.level === null ? undefined : sql`${level} = ${search.level}`,
              search.after ? after(search.after) : undefined,
            ),
          )
          .orderBy(desc(joinedAt), desc(memberships.id))
          .limit(search.limit),
      );
    },

    findActiveMember(communityId, userId) {
      return scoped(communityId, async ({ tx, where }) => {
        const [row] = await tx
          .select(memberColumns)
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .leftJoin(
            memberStats,
            and(
              eq(memberStats.communityId, memberships.communityId),
              eq(memberStats.userId, memberships.userId),
            ),
          )
          .where(
            where(memberships, eq(memberships.userId, userId), eq(memberships.status, "active")),
          )
          .limit(1);
        return row ?? null;
      });
    },

    recentActivity(communityId, userId, limit) {
      return scoped(communityId, async ({ tx, where }) => {
        const recentPosts = await tx
          .select({
            id: posts.id,
            title: posts.title,
            excerpt: posts.excerpt,
            createdAt: posts.createdAt,
          })
          .from(posts)
          .where(
            where(
              posts,
              eq(posts.authorId, userId),
              isNull(posts.deletedAt),
              isNull(posts.scheduledAt),
            ),
          )
          .orderBy(desc(posts.createdAt), desc(posts.id))
          .limit(limit);
        const recentComments = await tx
          .select({
            id: comments.id,
            postId: comments.postId,
            excerpt: sql<string>`left(${comments.bodyText}, 280)`,
            createdAt: comments.createdAt,
          })
          .from(comments)
          .innerJoin(posts, eq(posts.id, comments.postId))
          .where(
            where(
              comments,
              eq(comments.authorId, userId),
              isNull(comments.deletedAt),
              isNull(posts.deletedAt),
            ),
          )
          .orderBy(desc(comments.createdAt), desc(comments.id))
          .limit(limit);
        return { posts: recentPosts, comments: recentComments };
      });
    },

    findLevels(communityId, userIds) {
      return scoped(communityId, ({ tx, where }) =>
        tx
          .select({ userId: memberships.userId, level: level.mapWith(Number) })
          .from(memberships)
          .leftJoin(
            memberStats,
            and(
              eq(memberStats.communityId, memberships.communityId),
              eq(memberStats.userId, memberships.userId),
            ),
          )
          .where(
            where(
              memberships,
              eq(memberships.status, "active"),
              inArray(memberships.userId, [...userIds]),
            ),
          ),
      );
    },

    async updateBio(communityId, userId, bio) {
      await scoped(communityId, ({ tx, where }) =>
        tx
          .update(memberships)
          .set({ bio })
          .where(where(memberships, eq(memberships.userId, userId))),
      );
    },

    async findUsername(userId) {
      const [row] = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row?.username ?? null;
    },

    async setUsername(userId, username) {
      try {
        await db.update(users).set({ username }).where(eq(users.id, userId));
        return "updated";
      } catch (error: unknown) {
        if (isUniqueViolation(error, "users_username_unique")) {
          return "taken";
        }
        throw error;
      }
    },
  };
}
