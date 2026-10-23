import {
  getCommunityById,
  getMembership,
  parseCommunityId,
  runInCommunity,
  setRlsFlag,
  setRlsValue,
  withCommunity,
  type CommunityId,
  type Database,
  type ScopedQueries,
} from "@cohory/db";
import {
  comments,
  communities,
  communityGalleryItems,
  courses,
  eventOccurrences,
  eventRsvps,
  lessonProgress,
  inviteLinks,
  memberships,
  posts,
  reactions,
} from "@cohory/db/schema";
import { asc, count, eq, gt, gte, isNull, sql, type SQL } from "drizzle-orm";
import { createAccessStore } from "./postgres-access";
import { createAuditStore } from "./postgres-audit";
import { createMemberStore, criteriaConditions, membersQuery } from "./postgres-members";
import { countOf, first, required } from "./postgres-rows";

import { communityHealthQuery, setupCountsQuery } from "./postgres-health";
import type { ManageRepository, ManageStore } from "./repository";

function createStore(queries: ScopedQueries): ManageStore {
  const { tx, where, values, communityId } = queries;
  return {
    async enableManagement() {
      await setRlsFlag(tx, "community_manager");
    },

    async findCommunity() {
      const row = first(
        await tx.select().from(communities).where(eq(communities.id, communityId)).limit(1),
      );
      return row ? { ...row, id: parseCommunityId(row.id) } : null;
    },

    async updateCommunity(patch) {
      const row = required(
        await tx
          .update(communities)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(communities.id, communityId))
          .returning(),
      );
      return { ...row, id: parseCommunityId(row.id) };
    },

    async deleteCommunity(gate) {
      if (!(await gate(queries))) {
        return false;
      }
      const at = new Date();
      await tx
        .update(communities)
        .set({ deletedAt: at, updatedAt: at })
        .where(eq(communities.id, communityId));
      return true;
    },

    async lockCommunity() {
      await tx
        .select({ id: communities.id })
        .from(communities)
        .where(eq(communities.id, communityId))
        .for("update");
    },

    listGallery() {
      return tx
        .select()
        .from(communityGalleryItems)
        .where(where(communityGalleryItems))
        .orderBy(asc(communityGalleryItems.position), asc(communityGalleryItems.id));
    },

    async insertGalleryItem(item) {
      return required(await tx.insert(communityGalleryItems).values(values(item)).returning());
    },

    async updateGalleryAltText(itemId, altText) {
      return first(
        await tx
          .update(communityGalleryItems)
          .set({ altText, updatedAt: new Date() })
          .where(where(communityGalleryItems, eq(communityGalleryItems.id, itemId)))
          .returning(),
      );
    },

    async deleteGalleryItem(itemId) {
      return first(
        await tx
          .delete(communityGalleryItems)
          .where(where(communityGalleryItems, eq(communityGalleryItems.id, itemId)))
          .returning(),
      );
    },

    async setGalleryPositions(itemIds) {
      const at = new Date();
      for (const [position, itemId] of itemIds.entries()) {
        await tx
          .update(communityGalleryItems)
          .set({ position, updatedAt: at })
          .where(where(communityGalleryItems, eq(communityGalleryItems.id, itemId)));
      }
    },

    ...createMemberStore(queries),
    ...createAccessStore(queries),
    ...createAuditStore(queries),

    async overviewCounts(now, since) {
      const [memberCount, newMembers7d, posts7d, comments7d, upcomingEvents, publishedCourses] =
        await Promise.all([
          countOf(
            tx
              .select({ value: count() })
              .from(memberships)
              .where(where(memberships, eq(memberships.status, "active"))),
          ),
          countOf(
            tx
              .select({ value: count() })
              .from(memberships)
              .where(
                where(
                  memberships,
                  eq(memberships.status, "active"),
                  gte(memberships.joinedAt, since),
                ),
              ),
          ),
          countOf(
            tx
              .select({ value: count() })
              .from(posts)
              .where(
                where(
                  posts,
                  isNull(posts.deletedAt),
                  isNull(posts.scheduledAt),
                  gte(posts.createdAt, since),
                ),
              ),
          ),
          countOf(
            tx
              .select({ value: count() })
              .from(comments)
              .where(where(comments, isNull(comments.deletedAt), gte(comments.createdAt, since))),
          ),
          countOf(
            tx
              .select({ value: count() })
              .from(eventOccurrences)
              .where(
                where(
                  eventOccurrences,
                  gte(eventOccurrences.startsAt, now),
                  isNull(eventOccurrences.canceledAt),
                ),
              ),
          ),
          countOf(
            tx
              .select({ value: count() })
              .from(courses)
              .where(where(courses, eq(courses.status, "published"))),
          ),
        ]);
      return { memberCount, newMembers7d, posts7d, comments7d, upcomingEvents, publishedCourses };
    },

    setupCounts(now) {
      return setupCountsQuery(queries, now);
    },

    communityHealth(window) {
      return communityHealthQuery(queries, window);
    },
  };
}

export function createPostgresManageRepository(db: Database): ManageRepository {
  return {
    findCommunity: (communityId) => getCommunityById(db, communityId),

    async findMember(communityId, userId) {
      const membership = await getMembership(withCommunity(db, communityId), userId);
      return membership ? { role: membership.role, status: membership.status } : null;
    },

    findInviteByToken(token) {
      return db.transaction(async (tx) => {
        await setRlsValue(tx, "invite_token", token);
        const row = first(
          await tx.select().from(inviteLinks).where(eq(inviteLinks.token, token)).limit(1),
        );
        return row
          ? { id: row.id, communityId: parseCommunityId(row.communityId), invite: row }
          : null;
      });
    },

    inCommunity(communityId: CommunityId, options, fn) {
      return runInCommunity(withCommunity(db, communityId), async (queries) => {
        if (options.userId) {
          await setRlsValue(queries.tx, "user_id", options.userId);
        }
        if (options.inviteToken) {
          await setRlsValue(queries.tx, "invite_token", options.inviteToken);
        }
        return fn(createStore(queries));
      });
    },

    exportMembers(communityId, criteria, afterMembershipId, limit) {
      return runInCommunity(withCommunity(db, communityId), (queries) =>
        membersQuery(queries, [
          ...criteriaConditions(criteria),
          afterMembershipId ? gt(memberships.id, afterMembershipId) : undefined,
        ])
          .orderBy(asc(memberships.id))
          .limit(limit),
      );
    },

    async listCommunityIds(afterId, limit) {
      const rows = await db
        .select({ id: communities.id })
        .from(communities)
        .where(afterId ? gt(communities.id, afterId) : undefined)
        .orderBy(asc(communities.id))
        .limit(limit);
      return rows.map((row) => parseCommunityId(row.id));
    },

    backfillLastSeen(communityId, limit) {
      return runInCommunity(withCommunity(db, communityId), async ({ tx }) => {
        await setRlsFlag(tx, "course_manager");
        const latest = (table: SQL, column: SQL, user: SQL) =>
          sql`(select max(${column}) from ${table} where community_id = ${communityId} and ${user} = b.user_id)`;
        const result = await tx.execute(sql`
          with b as (
            select ${memberships.id} as id, ${memberships.userId} as user_id,
              ${memberships.joinedAt} as joined_at, ${memberships.createdAt} as created_at
            from ${memberships}
            where ${memberships.communityId} = ${communityId} and ${memberships.lastSeenAt} is null
            order by ${memberships.id}
            limit ${limit}
            for update skip locked
          )
          update ${memberships} set last_seen_at = coalesce(
            greatest(
              ${latest(sql`${posts}`, sql`created_at`, sql`author_id`)},
              ${latest(sql`${comments}`, sql`created_at`, sql`author_id`)},
              ${latest(sql`${reactions}`, sql`created_at`, sql`user_id`)},
              ${latest(sql`${lessonProgress}`, sql`last_viewed_at`, sql`user_id`)},
              ${latest(sql`${eventRsvps}`, sql`updated_at`, sql`user_id`)}
            ),
            b.joined_at,
            b.created_at
          )
          from b
          where ${memberships.id} = b.id`);
        return { updated: result.rowCount ?? 0 };
      });
    },
  };
}
