import { appendOutbox, type ScopedQueries } from "@cohory/db";
import { communityAccessIn } from "@cohory/entitlements/access";
import { memberships, users } from "@cohory/db/schema";
import { eq, inArray, sql } from "drizzle-orm";

import { postEventsTopic } from "../events";
import type { PostsStore } from "../repository";

export function createMemberStore(
  queries: ScopedQueries,
): Pick<
  PostsStore,
  | "appendEvents"
  | "findAccess"
  | "filterActiveMembers"
  | "findActiveMembersByUsername"
  | "findUserSummary"
> {
  const { tx, where, communityId } = queries;

  return {
    async appendEvents(outboxId, events) {
      await appendOutbox(tx, {
        id: outboxId,
        communityId,
        topic: postEventsTopic,
        payload: { events },
      });
    },

    findAccess(userId, now) {
      return communityAccessIn(queries, userId, now);
    },

    async filterActiveMembers(userIds) {
      const rows = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          where(
            memberships,
            inArray(memberships.userId, [...userIds]),
            eq(memberships.status, "active"),
          ),
        );
      return new Set(rows.map((row) => row.userId));
    },

    async findActiveMembersByUsername(names) {
      if (names.length === 0) {
        return [];
      }
      const rows = await tx
        .select({ userId: memberships.userId, username: users.username })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          where(
            memberships,
            eq(memberships.status, "active"),
            inArray(
              sql`lower(${users.username}::text)`,
              names.map((name) => name.toLowerCase()),
            ),
          ),
        );
      return rows.flatMap((row) =>
        row.username ? [{ userId: row.userId, username: row.username }] : [],
      );
    },

    async findUserSummary(userId) {
      const [row] = await tx
        .select({ id: users.id, name: users.name, image: users.image })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row ?? null;
    },
  };
}
