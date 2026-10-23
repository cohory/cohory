import {
  findMembershipIn,
  insertMembershipIfAbsentIn,
  isEmailBannedIn,
  memberUsageIn,
  setMembershipStatusIn,
  type ScopedQueries,
} from "@cohory/db";
import { communityAccessIn } from "@cohory/entitlements/access";
import { memberships, pendingJoinAnswers, users } from "@cohory/db/schema";
import type { JoinAnswerJson } from "@cohory/db/schema";
import { and, eq, isNull } from "drizzle-orm";

import { createHoldStore } from "../holds/postgres-store";
import type { HoldSettlement } from "../holds/store";
import type { PaymentsStore } from "../repository";
import { first } from "./rows";

async function takePendingJoinAnswers(
  { tx, where }: ScopedQueries,
  userId: string,
): Promise<JoinAnswerJson[] | null> {
  const [row] = await tx
    .delete(pendingJoinAnswers)
    .where(where(pendingJoinAnswers, eq(pendingJoinAnswers.userId, userId)))
    .returning({ answers: pendingJoinAnswers.answers });
  return row?.answers ?? null;
}

export async function activateMemberIn(
  queries: ScopedQueries,
  userId: string,
  at: Date,
): Promise<HoldSettlement> {
  const settled = await createHoldStore(queries).settleOnActivation(userId);
  const answers = await takePendingJoinAnswers(queries, userId);
  const existing = await findMembershipIn(queries, userId);
  if (!existing) {
    await insertMembershipIfAbsentIn(queries, {
      userId,
      role: "member",
      status: "active",
      joinedAt: at,
      ...(answers ? { joinAnswers: answers } : {}),
    });
    return settled;
  }
  if (existing.status === "removed" || existing.status === "pending") {
    await setMembershipStatusIn(queries, userId, "active", at);
  }
  if (answers) {
    await queries.tx
      .update(memberships)
      .set({ joinAnswers: answers, updatedAt: new Date() })
      .where(queries.where(memberships, eq(memberships.userId, userId)));
  }
  return settled;
}

export async function removeMemberIn(queries: ScopedQueries, userId: string): Promise<void> {
  const existing = await findMembershipIn(queries, userId);
  if (existing?.status === "active" && existing.role === "member") {
    await setMembershipStatusIn(queries, userId, "removed");
  }
}

export function createMemberStore(
  queries: ScopedQueries,
): Pick<
  PaymentsStore,
  | "findMember"
  | "findAccess"
  | "lockMember"
  | "activateMember"
  | "removeMember"
  | "isEmailBanned"
  | "findUserEmail"
  | "findReachableEmail"
  | "isUserEmailConfirmed"
  | "findUserName"
  | "findOwnerId"
  | "memberUsage"
  | "savePendingJoinAnswers"
> {
  const { tx, where, values } = queries;

  return {
    findMember(userId) {
      return findMembershipIn(queries, userId);
    },

    findAccess(userId, now) {
      return communityAccessIn(queries, userId, now);
    },

    async lockMember(userId) {
      await createHoldStore(queries).lock(userId);
      return first(
        tx
          .select({
            role: memberships.role,
            status: memberships.status,
            removalReason: memberships.removalReason,
          })
          .from(memberships)
          .where(where(memberships, eq(memberships.userId, userId)))
          .for("update")
          .limit(1),
      );
    },

    activateMember(userId, at) {
      return activateMemberIn(queries, userId, at);
    },

    removeMember(userId) {
      return removeMemberIn(queries, userId);
    },

    isEmailBanned(userId) {
      return isEmailBannedIn(queries, userId);
    },

    async findUserEmail(userId) {
      const row = await first(
        tx.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1),
      );
      return row?.email ?? null;
    },

    async findReachableEmail(userId) {
      const row = await first(
        tx
          .select({ email: users.email })
          .from(users)
          .where(and(eq(users.id, userId), isNull(users.erasedAt)))
          .limit(1),
      );
      return row?.email ?? null;
    },

    async isUserEmailConfirmed(userId) {
      const row = await first(
        tx
          .select({ emailVerified: users.emailVerified })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1),
      );
      return row?.emailVerified ?? false;
    },

    async findUserName(userId) {
      const row = await first(
        tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1),
      );
      return row?.name ?? null;
    },

    async findOwnerId() {
      const row = await first(
        tx
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            where(memberships, eq(memberships.role, "owner"), eq(memberships.status, "active")),
          )
          .limit(1),
      );
      return row?.userId ?? null;
    },

    memberUsage(userId, now) {
      return memberUsageIn(queries, userId, now);
    },

    async savePendingJoinAnswers(userId, answers) {
      if (answers.length === 0) {
        await tx
          .delete(pendingJoinAnswers)
          .where(where(pendingJoinAnswers, eq(pendingJoinAnswers.userId, userId)));
        return;
      }
      await tx
        .insert(pendingJoinAnswers)
        .values(values({ userId, answers: [...answers] }))
        .onConflictDoUpdate({
          target: [pendingJoinAnswers.communityId, pendingJoinAnswers.userId],
          set: { answers: [...answers], updatedAt: new Date() },
        });
    },
  };
}
