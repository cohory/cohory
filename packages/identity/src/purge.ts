import { getDb, setMemberRemovalReason, setRlsFlag, type Database } from "@cohory/db";
import {
  accounts,
  agentIdentities,
  apiTokens,
  compInvitations,
  compedMemberships,
  contentReports,
  creatorFeedback,
  eventRsvps,
  lessonProgress,
  memberStats,
  membershipRequests,
  memberships,
  notificationDeliveries,
  notificationPreferences,
  notifications,
  notificationSettings,
  reviewReports,
  reviews,
  sessions,
  users,
  verifications,
} from "@cohory/db/schema";
import { paidCommunityBlockers, type PaidCommunityBlockers } from "@cohory/payments/account";
import { and, asc, eq, isNull, lte, ne, sql } from "drizzle-orm";

import { actAsUser, audit, blockingCommunities } from "./queries";

export const accountPurgeJob = "identity.account-purge";
export const accountPurgeCron = "17 * * * *";
export const formerMemberName = "Former member";
const batchSize = 50;

export type ReleaseBilling = (communityId: string, userId: string) => Promise<void>;

export interface AccountPurgeDeps {
  readonly db: Database;
  readonly now?: () => Date;
  readonly deleteAvatar?: (userId: string) => Promise<void>;
  readonly onAvatarError?: (error: unknown, userId: string) => void;
  readonly releaseBilling?: ReleaseBilling;
  readonly onBillingError?: (error: unknown, userId: string) => void;
  readonly paidCommunityBlockers?: PaidCommunityBlockers;
}

export type PurgeOutcome = "erased" | "blocked" | "billing_pending" | "not_due";

export interface PurgeRunResult {
  readonly erased: number;
  readonly blocked: number;
}

export function erasedEmail(userId: string): string {
  return `erased-${userId}@erased.invalid`;
}

export function createAccountPurge(deps: AccountPurgeDeps) {
  const now = deps.now ?? (() => new Date());
  const db = deps.db;

  async function communitiesOf(userId: string): Promise<string[]> {
    return db.transaction(async (tx) => {
      await actAsUser(tx, userId);
      const rows = await tx
        .select({ communityId: memberships.communityId })
        .from(memberships)
        .where(eq(memberships.userId, userId));
      return rows.map((row) => row.communityId);
    });
  }

  async function clearCommunityData(userId: string, communityId: string, at: Date): Promise<void> {
    await db.transaction(async (tx) => {
      await actAsUser(tx, userId, communityId);
      await setMemberRemovalReason(tx, "left");
      await tx
        .update(memberships)
        .set({
          status: sql`case when ${memberships.status} = 'banned' then 'banned'::member_status else 'removed'::member_status end`,
          bio: null,
          joinAnswers: null,
          lastSeenAt: null,
        })
        .where(and(eq(memberships.communityId, communityId), eq(memberships.userId, userId)));
      await tx
        .delete(eventRsvps)
        .where(and(eq(eventRsvps.communityId, communityId), eq(eventRsvps.userId, userId)));
      await tx
        .delete(lessonProgress)
        .where(and(eq(lessonProgress.communityId, communityId), eq(lessonProgress.userId, userId)));
      await tx
        .delete(memberStats)
        .where(and(eq(memberStats.communityId, communityId), eq(memberStats.userId, userId)));
      await tx
        .update(apiTokens)
        .set({ revokedAt: at })
        .where(
          and(
            eq(apiTokens.communityId, communityId),
            eq(apiTokens.userId, userId),
            isNull(apiTokens.revokedAt),
          ),
        );
      await tx
        .update(agentIdentities)
        .set({ status: "revoked", revokedAt: at, updatedAt: at })
        .where(
          and(
            eq(agentIdentities.communityId, communityId),
            eq(agentIdentities.ownerId, userId),
            ne(agentIdentities.status, "revoked"),
          ),
        );
    });
  }

  async function clearRowsInEveryCommunity(userId: string, at: Date): Promise<void> {
    await db.transaction(async (tx) => {
      await actAsUser(tx, userId);
      await setRlsFlag(tx, "account_purge");
      await tx
        .update(membershipRequests)
        .set({ answers: [], decisionNote: null })
        .where(eq(membershipRequests.userId, userId));
      await tx
        .update(contentReports)
        .set({ note: null })
        .where(eq(contentReports.reporterId, userId));
      await tx.delete(compInvitations).where(eq(compInvitations.acceptedBy, userId));
      await tx.delete(compedMemberships).where(eq(compedMemberships.userId, userId));
      await tx
        .update(reviews)
        .set({ membershipId: null, anonymizedAt: at, updatedAt: at })
        .where(eq(reviews.authorId, userId));
      await tx
        .update(reviewReports)
        .set({ note: null })
        .where(eq(reviewReports.reporterId, userId));
    });
  }

  async function purgeAccount(userId: string): Promise<PurgeOutcome> {
    const at = now();
    const ready = await db.transaction(async (tx) => {
      await actAsUser(tx, userId);
      const [user] = await tx
        .select({ scheduledFor: users.deletionScheduledFor })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.erasedAt)));
      if (!user?.scheduledFor || user.scheduledFor > at) {
        return "not_due" as const;
      }
      const blocking = await blockingCommunities(tx, userId, deps.paidCommunityBlockers);
      return blocking.length > 0 ? "blocked" : "ready";
    });
    if (ready !== "ready") {
      return ready;
    }

    const communityIds = await communitiesOf(userId);
    if (deps.releaseBilling) {
      try {
        for (const communityId of communityIds) {
          await deps.releaseBilling(communityId, userId);
        }
      } catch (error: unknown) {
        deps.onBillingError?.(error, userId);
        return "billing_pending";
      }
    }
    for (const communityId of communityIds) {
      await clearCommunityData(userId, communityId, at);
    }
    await clearRowsInEveryCommunity(userId, at);

    await db.transaction(async (tx) => {
      await actAsUser(tx, userId);
      const [user] = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      await tx.delete(notificationDeliveries).where(eq(notificationDeliveries.userId, userId));
      await tx.delete(notifications).where(eq(notifications.userId, userId));
      await tx.delete(notificationPreferences).where(eq(notificationPreferences.userId, userId));
      await tx.delete(notificationSettings).where(eq(notificationSettings.userId, userId));
      await tx.delete(creatorFeedback).where(eq(creatorFeedback.userId, userId));
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      await tx.delete(accounts).where(eq(accounts.userId, userId));
      if (user) {
        await tx.delete(verifications).where(eq(verifications.identifier, user.email));
      }
      await tx
        .update(users)
        .set({
          name: formerMemberName,
          email: erasedEmail(userId),
          emailVerified: false,
          image: null,
          username: null,
          erasedAt: at,
        })
        .where(eq(users.id, userId));
      await audit(tx, userId, "account.erased", { communities: communityIds.length }, at);
    });

    if (deps.deleteAvatar) {
      try {
        await deps.deleteAvatar(userId);
      } catch (error: unknown) {
        deps.onAvatarError?.(error, userId);
      }
    }
    return "erased";
  }

  return {
    purgeAccount,

    async purgeDueAccounts(): Promise<PurgeRunResult> {
      const due = await db
        .select({ id: users.id })
        .from(users)
        .where(and(lte(users.deletionScheduledFor, now()), isNull(users.erasedAt)))
        .orderBy(asc(users.deletionScheduledFor))
        .limit(batchSize);
      let erased = 0;
      let blocked = 0;
      for (const { id } of due) {
        const outcome = await purgeAccount(id);
        if (outcome === "erased") erased += 1;
        if (outcome === "blocked" || outcome === "billing_pending") blocked += 1;
      }
      return { erased, blocked };
    },
  };
}

export type AccountPurge = ReturnType<typeof createAccountPurge>;

let defaultPurge: AccountPurge | undefined;

export function getAccountPurge(
  options: Pick<
    AccountPurgeDeps,
    "deleteAvatar" | "onAvatarError" | "releaseBilling" | "onBillingError"
  > = {},
): AccountPurge {
  defaultPurge ??= createAccountPurge({
    db: getDb(),
    paidCommunityBlockers: paidCommunityBlockers(),
    ...options,
  });
  return defaultPurge;
}
