import { hasPaidTransactionSince, setMemberRemovalReason, type ScopedQueries } from "@cohory/db";
import {
  accounts,
  memberStats,
  membershipHolds,
  memberships,
  sessions,
  users,
} from "@cohory/db/schema";
import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";

import type {
  ManageMemberCursor,
  ManageMemberFilter,
  ManageStore,
  MemberCriteria,
  UserIdFilter,
} from "./repository";

import { countOf, first } from "./postgres-rows";

const sortAt = sql<Date>`coalesce(${memberships.joinedAt}, ${memberships.createdAt})`;

const seenInCommunity = sql`coalesce(${memberships.lastSeenAt}, ${memberships.joinedAt}, ${memberships.createdAt})`;

const lastSignIn = sql`(select max(${sessions.updatedAt}) from ${sessions} where ${sessions.userId} = ${memberships.userId})`;

const lastActiveAt = sql<Date>`greatest(${seenInCommunity}, ${lastSignIn})`;

const signedIn = sql<boolean>`(${users.emailVerified} or exists (select 1 from ${sessions} where ${sessions.userId} = ${memberships.userId}) or exists (select 1 from ${accounts} where ${accounts.userId} = ${memberships.userId}))`;

function byUserIds(filter: UserIdFilter): SQL {
  const ids = sql`${`{${filter.ids.join(",")}}`}::uuid[]`;
  return filter.mode === "include"
    ? sql`${memberships.userId} = any(${ids})`
    : sql`not (${memberships.userId} = any(${ids}))`;
}

function inactiveBefore(cutoff: Date): SQL {
  const at = cutoff.toISOString();
  return sql`(${memberships.lastSeenAt} < ${at}::timestamptz or (${memberships.lastSeenAt} is null and coalesce(${memberships.joinedAt}, ${memberships.createdAt}) < ${at}::timestamptz)) and not exists (select 1 from ${sessions} where ${sessions.userId} = ${memberships.userId} and ${sessions.updatedAt} >= ${at}::timestamptz)`;
}

export function criteriaConditions(criteria: MemberCriteria): (SQL | undefined)[] {
  return [
    criteria.query ? matches(criteria.query, criteria.searchEmail) : undefined,
    criteria.role ? eq(memberships.role, criteria.role) : undefined,
    criteria.status ? eq(memberships.status, criteria.status) : undefined,
    criteria.inactiveBefore ? inactiveBefore(criteria.inactiveBefore) : undefined,
    criteria.neverSignedIn ? sql`not ${signedIn}` : undefined,
    criteria.userIds ? byUserIds(criteria.userIds) : undefined,
  ];
}

const memberColumns = {
  membershipId: memberships.id,
  userId: memberships.userId,
  name: users.name,
  username: users.username,
  image: users.image,
  email: users.email,
  role: memberships.role,
  status: memberships.status,
  joinedAt: memberships.joinedAt,
  sortAt: sql<Date>`${sortAt}`.mapWith(memberships.createdAt),
  lastActiveAt: sql<Date>`${lastActiveAt}`.mapWith(memberships.createdAt),
  signedIn: sql<boolean>`${signedIn}`.mapWith(Boolean),
  level: sql<number>`coalesce(${memberStats.level}, 1)::integer`.mapWith(Number),
  points: sql<number>`coalesce(${memberStats.pointsTotal}, 0)`.mapWith(Number),
};

function prefix(query: string): string {
  return `${query.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function matches(query: string, searchEmail: boolean): SQL {
  const pattern = prefix(query);
  const byName = sql`lower(${users.name}) like ${pattern} or lower(${users.username}::text) like ${pattern}`;
  return searchEmail
    ? sql`(${byName} or lower(${users.email}::text) like ${pattern})`
    : sql`(${byName})`;
}

function after(cursor: ManageMemberCursor): SQL {
  return sql`(${sortAt}, ${memberships.id}) < (${cursor.sortAt.toISOString()}::timestamptz, ${cursor.membershipId}::uuid)`;
}

export function membersQuery({ tx, where }: ScopedQueries, conditions: (SQL | undefined)[]) {
  return tx
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
    .where(where(memberships, ...conditions));
}

export function createMemberStore(
  queries: ScopedQueries,
): Pick<
  ManageStore,
  | "findMember"
  | "findUserEmail"
  | "isEmailBanned"
  | "setRole"
  | "setStatus"
  | "insertMembershipIfAbsent"
  | "holdMembership"
  | "listMembers"
  | "hasPaidTransactionSince"
  | "countActiveMembers"
> {
  const { tx, where, values } = queries;

  return {
    async findMember(userId) {
      return first(
        await tx
          .select()
          .from(memberships)
          .where(where(memberships, eq(memberships.userId, userId)))
          .limit(1),
      );
    },

    async findUserEmail(userId) {
      const row = first(
        await tx.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1),
      );
      return row?.email ?? null;
    },

    async isEmailBanned(email) {
      const row = first(
        await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            where(
              memberships,
              eq(memberships.status, "banned"),
              sql`${memberships.bannedEmail} = ${email}::citext`,
            ),
          )
          .limit(1),
      );
      return row !== null;
    },

    async setRole(userId, role) {
      await tx
        .update(memberships)
        .set({ role, updatedAt: new Date() })
        .where(where(memberships, eq(memberships.userId, userId)));
    },

    async setStatus(userId, status, options = {}) {
      if (options.removedByStaff) {
        await setMemberRemovalReason(tx, "removed");
      }
      return first(
        await tx
          .update(memberships)
          .set({
            status,
            bannedEmail: options.bannedEmail ?? null,
            ...(options.joinedAt ? { joinedAt: options.joinedAt } : {}),
            ...(options.role ? { role: options.role } : {}),
            updatedAt: new Date(),
          })
          .where(where(memberships, eq(memberships.userId, userId)))
          .returning(),
      );
    },

    async insertMembershipIfAbsent(userId, joinedAt) {
      return first(
        await tx
          .insert(memberships)
          .values(values({ userId, role: "member" as const, status: "active" as const, joinedAt }))
          .onConflictDoNothing({ target: [memberships.communityId, memberships.userId] })
          .returning(),
      );
    },

    async holdMembership(userId, hold) {
      await tx
        .select({ userId: membershipHolds.userId })
        .from(membershipHolds)
        .where(where(membershipHolds, eq(membershipHolds.userId, userId)))
        .for("update");
      const [held] = await tx
        .insert(memberships)
        .values(values({ userId, role: "member" as const, status: "pending" as const }))
        .onConflictDoUpdate({
          target: [memberships.communityId, memberships.userId],
          set: { status: "pending", removalReason: null, updatedAt: new Date() },
          setWhere: sql`${memberships.status} = 'removed'`,
        })
        .returning({ id: memberships.id });
      if (held === undefined) {
        return false;
      }
      await tx
        .insert(membershipHolds)
        .values(values({ userId, inviteId: hold.inviteId, expiresAt: hold.expiresAt }))
        .onConflictDoUpdate({
          target: [membershipHolds.communityId, membershipHolds.userId],
          set: {
            inviteId: hold.inviteId,
            expiresAt: hold.expiresAt,
            releasedAt: null,
            createdAt: new Date(),
          },
        });
      return true;
    },

    listMembers(filter: ManageMemberFilter) {
      return membersQuery(queries, [
        ...criteriaConditions(filter),
        filter.cursor ? after(filter.cursor) : undefined,
      ])
        .orderBy(desc(sortAt), desc(memberships.id))
        .limit(filter.limit);
    },

    hasPaidTransactionSince(since) {
      return hasPaidTransactionSince(queries, since);
    },

    countActiveMembers() {
      return countOf(
        tx
          .select({ value: count() })
          .from(memberships)
          .where(where(memberships, eq(memberships.status, "active"))),
      );
    },
  };
}
