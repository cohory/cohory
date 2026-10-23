import {
  createCommunityWithOwner,
  findMovedCommunitySlug,
  getCommunityById,
  getCommunityBySlug,
  getMembership,
  hasPaidTransactionSince,
  insertMembershipIfAbsent,
  isEmailBanned,
  leaveMembership,
  listCommunitiesForUser,
  runInCommunity,
  setMembershipStatus,
  setRlsValue,
  withCommunity,
  type CommunityId,
  type Database,
} from "@cohory/db";
import { getCommunityAccess } from "@cohory/entitlements/access";
import { communityGalleryItems, memberships, users } from "@cohory/db/schema";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { CommunitiesRepository, NameSearch } from "./repository";
import type { AboutPeople, MemberListItem } from "./views";

async function countActiveMembers(db: Database, communityId: CommunityId): Promise<number> {
  return runInCommunity(withCommunity(db, communityId), async ({ tx, where }) => {
    const [row] = await tx
      .select({ value: count() })
      .from(memberships)
      .where(where(memberships, eq(memberships.status, "active")));
    return row?.value ?? 0;
  });
}

async function countActiveMembersIn(
  db: Database,
  communityIds: readonly CommunityId[],
): Promise<ReadonlyMap<CommunityId, number>> {
  const counts = new Map<CommunityId, number>();
  if (communityIds.length === 0) {
    return counts;
  }
  // Row level security scopes memberships to one community per setting, so the counts run as
  // one statement per community inside a single transaction on a single connection.
  await db.transaction(async (tx) => {
    for (const communityId of communityIds) {
      await setRlsValue(tx, "community_id", communityId);
      const [row] = await tx
        .select({ value: count() })
        .from(memberships)
        .where(and(eq(memberships.communityId, communityId), eq(memberships.status, "active")));
      counts.set(communityId, row?.value ?? 0);
    }
  });
  return counts;
}

const normalizedName = sql`regexp_replace(lower(${users.name}), '[^[:alnum:]]+', '', 'g')`;

function likePrefix(value: string): string {
  return `${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

async function searchActiveMembers(
  db: Database,
  communityId: CommunityId,
  search: NameSearch,
): Promise<MemberListItem[]> {
  return runInCommunity(withCommunity(db, communityId), ({ tx, where }) =>
    tx
      .select({
        userId: memberships.userId,
        name: users.name,
        image: users.image,
        role: memberships.role,
        joinedAt: memberships.joinedAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        where(
          memberships,
          eq(memberships.status, "active"),
          sql`${normalizedName} like ${likePrefix(search.prefix)}`,
        ),
      )
      .orderBy(asc(memberships.role), asc(memberships.joinedAt), asc(memberships.id))
      .limit(search.limit),
  );
}

async function aboutPeople(
  db: Database,
  communityId: CommunityId,
  avatarLimit: number,
): Promise<AboutPeople> {
  return runInCommunity(withCommunity(db, communityId), async ({ tx, where }) => {
    const active = eq(memberships.status, "active");
    const [owners, admins, avatars] = await Promise.all([
      tx
        .select({ name: users.name, image: users.image })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(where(memberships, active, eq(memberships.role, "owner")))
        .limit(1),
      tx
        .select({ value: count() })
        .from(memberships)
        .where(where(memberships, active, inArray(memberships.role, ["owner", "admin"]))),
      tx
        .select({ name: users.name, image: users.image })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(where(memberships, active))
        .orderBy(
          sql`${users.image} is null`,
          desc(sql`coalesce(${memberships.joinedAt}, ${memberships.createdAt})`),
          asc(memberships.id),
        )
        .limit(avatarLimit),
    ]);
    return { owner: owners[0] ?? null, adminCount: admins[0]?.value ?? 0, avatars };
  });
}

export function createPostgresCommunitiesRepository(db: Database): CommunitiesRepository {
  return {
    createCommunityWithOwner: (input) => createCommunityWithOwner(db, input),
    findCommunityBySlug: (slug) => getCommunityBySlug(db, slug),
    findMovedCommunitySlug: (formerSlug) => findMovedCommunitySlug(db, formerSlug),
    findCommunityById: (id) => getCommunityById(db, id),
    findConfirmedEmail: async (userId) => {
      const [row] = await db
        .select({ email: users.email })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.emailVerified, true)))
        .limit(1);
      return row?.email ?? null;
    },
    findMembership: (communityId, userId) => getMembership(withCommunity(db, communityId), userId),
    findAccess: (communityId, userId) =>
      getCommunityAccess(withCommunity(db, communityId), userId, new Date()),
    insertMembershipIfAbsent: (communityId, input) =>
      insertMembershipIfAbsent(withCommunity(db, communityId), input),
    leaveMembership: (communityId, userId) =>
      leaveMembership(withCommunity(db, communityId), userId),
    dismissOnboarding: (communityId, userId, at) =>
      runInCommunity(withCommunity(db, communityId), async ({ tx, where }) => {
        await tx
          .update(memberships)
          .set({ onboardingDismissedAt: at })
          .where(
            where(
              memberships,
              eq(memberships.userId, userId),
              isNull(memberships.onboardingDismissedAt),
            ),
          );
      }),
    setMembershipStatus: (communityId, userId, status, joinedAt) =>
      setMembershipStatus(withCommunity(db, communityId), userId, status, joinedAt),
    listCommunitiesForUser: (userId) => listCommunitiesForUser(db, userId),
    countActiveMembers: (communityId) => countActiveMembers(db, communityId),
    countActiveMembersIn: (communityIds) => countActiveMembersIn(db, communityIds),
    hasPaidTransactionSince: (communityId, since) =>
      runInCommunity(withCommunity(db, communityId), (queries) =>
        hasPaidTransactionSince(queries, since),
      ),
    isEmailBanned: (communityId, userId) => isEmailBanned(withCommunity(db, communityId), userId),
    searchActiveMembers: (communityId, search) => searchActiveMembers(db, communityId, search),
    listGallery: (communityId) =>
      runInCommunity(withCommunity(db, communityId), ({ tx, where }) =>
        tx
          .select()
          .from(communityGalleryItems)
          .where(where(communityGalleryItems))
          .orderBy(asc(communityGalleryItems.position), asc(communityGalleryItems.id)),
      ),
    aboutPeople: (communityId, avatarLimit) => aboutPeople(db, communityId, avatarLimit),
  };
}
