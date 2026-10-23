import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { setRlsValue, setMemberRemovalReason } from "../tenancy/session";

import type { Database } from "../client";
import {
  communities,
  memberships,
  users,
  type MembershipJoinAnswers,
  type MemberRole,
  type MemberStatus,
} from "../schema";
import {
  parseCommunityId,
  runInCommunity,
  type CommunityScope,
  type ScopedQueries,
} from "../tenancy/scope";
import type { Community } from "./communities";

export type Membership = typeof memberships.$inferSelect;

export interface NewMembership {
  userId: string;
  status: MemberStatus;
  role?: MemberRole;
  joinAnswers?: MembershipJoinAnswers;
  joinedAt?: Date;
}

export interface CommunityMembership {
  community: Community;
  membership: Membership;
}

export async function addMembership(
  scope: CommunityScope,
  input: NewMembership,
): Promise<Membership> {
  return runInCommunity(scope, async ({ tx, values }) => {
    const [row] = await tx.insert(memberships).values(values(input)).returning();
    if (!row) {
      throw new Error("membership insert returned no row");
    }
    return row;
  });
}

export async function insertMembershipIfAbsent(
  scope: CommunityScope,
  input: NewMembership,
): Promise<{ membership: Membership; created: boolean }> {
  return runInCommunity(scope, (queries) => insertMembershipIfAbsentIn(queries, input));
}

export async function insertMembershipIfAbsentIn(
  { tx, values, where }: ScopedQueries,
  input: NewMembership,
): Promise<{ membership: Membership; created: boolean }> {
  const [inserted] = await tx
    .insert(memberships)
    .values(values(input))
    // No conflict target: concurrent owner inserts can collide on the one owner index first,
    // and Postgres raises on unique indexes that are not the ON CONFLICT arbiter.
    .onConflictDoNothing()
    .returning();
  if (inserted) {
    return { membership: inserted, created: true };
  }
  const [existing] = await tx
    .select()
    .from(memberships)
    .where(where(memberships, eq(memberships.userId, input.userId)))
    .limit(1);
  if (!existing) {
    throw new Error("membership conflict without an existing row");
  }
  return { membership: existing, created: false };
}

export async function getMembership(
  scope: CommunityScope,
  userId: string,
): Promise<Membership | null> {
  return runInCommunity(scope, async ({ tx, where }) => {
    const [row] = await tx
      .select()
      .from(memberships)
      .where(where(memberships, eq(memberships.userId, userId)))
      .limit(1);
    return row ?? null;
  });
}

export async function setMembershipStatus(
  scope: CommunityScope,
  userId: string,
  status: MemberStatus,
  joinedAt?: Date,
): Promise<Membership | null> {
  return runInCommunity(scope, (queries) =>
    setMembershipStatusIn(queries, userId, status, joinedAt),
  );
}

export async function setMembershipStatusIn(
  { tx, where }: ScopedQueries,
  userId: string,
  status: MemberStatus,
  joinedAt?: Date,
): Promise<Membership | null> {
  const [row] = await tx
    .update(memberships)
    .set({
      status,
      ...(joinedAt ? { joinedAt } : {}),
      ...(status === "active" ? { role: roleKeptOnlyWhileActive } : {}),
    })
    .where(where(memberships, eq(memberships.userId, userId)))
    .returning();
  return row ?? null;
}

export type MembershipFacts = Pick<Membership, "role" | "status" | "removalReason" | "joinedAt">;

export async function findMembershipIn(
  { tx, communityId }: Pick<ScopedQueries, "tx" | "communityId">,
  userId: string,
): Promise<MembershipFacts | null> {
  const [row] = await tx
    .select({
      role: memberships.role,
      status: memberships.status,
      removalReason: memberships.removalReason,
      joinedAt: memberships.joinedAt,
    })
    .from(memberships)
    .where(and(eq(memberships.communityId, communityId), eq(memberships.userId, userId)))
    .limit(1);
  return row ?? null;
}

const roleKeptOnlyWhileActive = sql<MemberRole>`case when ${memberships.status} = 'active' then ${memberships.role} else 'member' end`;

export async function isEmailBannedIn(
  { tx, where }: ScopedQueries,
  userId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      where(
        memberships,
        eq(memberships.status, "banned"),
        sql`${memberships.bannedEmail} = (select ${users.email} from ${users} where ${users.id} = ${userId})`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

export function isEmailBanned(scope: CommunityScope, userId: string): Promise<boolean> {
  return runInCommunity(scope, (queries) => isEmailBannedIn(queries, userId));
}

export async function leaveMembership(
  scope: CommunityScope,
  userId: string,
): Promise<Membership | null> {
  return runInCommunity(scope, async ({ tx, where }) => {
    await setMemberRemovalReason(tx, "left");
    const [row] = await tx
      .update(memberships)
      .set({ status: "removed", role: "member" })
      .where(where(memberships, eq(memberships.userId, userId)))
      .returning();
    return row ?? null;
  });
}

export async function restoreLeftMembership(
  scope: CommunityScope,
  userId: string,
  joinedAt: Date,
): Promise<Membership | null> {
  return runInCommunity(scope, async ({ tx, where }) => {
    const [row] = await tx
      .update(memberships)
      .set({ status: "active", role: "member", joinedAt })
      .where(
        where(
          memberships,
          and(
            eq(memberships.userId, userId),
            eq(memberships.status, "removed"),
            eq(memberships.removalReason, "left"),
          ),
        ),
      )
      .returning();
    return row ?? null;
  });
}

export async function listMembershipsForCommunity(scope: CommunityScope): Promise<Membership[]> {
  return runInCommunity(scope, ({ tx, where }) =>
    tx.select().from(memberships).where(where(memberships)).orderBy(asc(memberships.id)),
  );
}

export async function getMembershipRole(
  scope: CommunityScope,
  userId: string,
): Promise<MemberRole | null> {
  const row = await getMembership(scope, userId);
  return row?.status === "active" ? row.role : null;
}

export async function listCommunitiesForUser(
  db: Database,
  userId: string,
): Promise<CommunityMembership[]> {
  return db.transaction(async (tx) => {
    await setRlsValue(tx, "user_id", userId);
    const rows = await tx
      .select({ community: communities, membership: memberships })
      .from(memberships)
      .innerJoin(communities, eq(communities.id, memberships.communityId))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, "active"),
          isNull(communities.deletedAt),
        ),
      )
      .orderBy(asc(communities.name), asc(communities.id));
    return rows.map(({ community, membership }) => ({
      community: { ...community, id: parseCommunityId(community.id) },
      membership,
    }));
  });
}
