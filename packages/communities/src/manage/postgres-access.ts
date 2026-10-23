import { type ScopedQueries } from "@cohory/db";
import {
  inviteLinks,
  type JoinAnswerJson,
  membershipRequests,
  memberships,
  type MembershipJoinAnswers,
  users,
} from "@cohory/db/schema";
import { asc, count, desc, eq, gt, isNull, or, sql } from "drizzle-orm";

import type { ManageStore } from "./repository";

import { countOf, first, required } from "./postgres-rows";

function pairedAnswers(answers: MembershipJoinAnswers | null): readonly JoinAnswerJson[] {
  const paired: JoinAnswerJson[] = [];
  for (const answer of answers ?? []) {
    if (typeof answer !== "string") paired.push(answer);
  }
  return paired;
}

export function createAccessStore(
  queries: ScopedQueries,
): Pick<
  ManageStore,
  | "insertInvite"
  | "listInvites"
  | "revokeInvite"
  | "consumeInvite"
  | "insertJoinRequest"
  | "findLatestJoinRequest"
  | "findPaidJoinAnswers"
  | "findJoinRequest"
  | "listPendingJoinRequests"
  | "countPendingJoinRequests"
  | "decideJoinRequest"
> {
  const { tx, where, values } = queries;

  return {
    async insertInvite(invite) {
      return required(await tx.insert(inviteLinks).values(values(invite)).returning());
    },

    listInvites() {
      return tx
        .select()
        .from(inviteLinks)
        .where(where(inviteLinks))
        .orderBy(desc(inviteLinks.createdAt), desc(inviteLinks.id));
    },

    async revokeInvite(inviteId, at) {
      return first(
        await tx
          .update(inviteLinks)
          .set({
            revokedAt: sql`coalesce(${inviteLinks.revokedAt}, ${at.toISOString()}::timestamptz)`,
          })
          .where(where(inviteLinks, eq(inviteLinks.id, inviteId)))
          .returning(),
      );
    },

    async consumeInvite(inviteId, now) {
      const rows = await tx
        .update(inviteLinks)
        .set({ useCount: sql`${inviteLinks.useCount} + 1` })
        .where(
          where(
            inviteLinks,
            eq(inviteLinks.id, inviteId),
            isNull(inviteLinks.revokedAt),
            or(isNull(inviteLinks.expiresAt), gt(inviteLinks.expiresAt, now)),
            or(isNull(inviteLinks.maxUses), sql`${inviteLinks.useCount} < ${inviteLinks.maxUses}`),
          ),
        )
        .returning({ id: inviteLinks.id });
      return rows.length > 0;
    },

    async insertJoinRequest(userId, answers) {
      return first(
        await tx
          .insert(membershipRequests)
          .values(values({ userId, answers: [...answers], status: "pending" as const }))
          .onConflictDoNothing()
          .returning(),
      );
    },

    async findLatestJoinRequest(userId) {
      return first(
        await tx
          .select()
          .from(membershipRequests)
          .where(where(membershipRequests, eq(membershipRequests.userId, userId)))
          .orderBy(desc(membershipRequests.createdAt), desc(membershipRequests.id))
          .limit(1),
      );
    },

    async findPaidJoinAnswers(userId) {
      const row = first(
        await tx
          .select({ answers: memberships.joinAnswers })
          .from(memberships)
          .where(where(memberships, eq(memberships.userId, userId))),
      );
      return pairedAnswers(row?.answers ?? null);
    },

    async findJoinRequest(requestId) {
      return first(
        await tx
          .select()
          .from(membershipRequests)
          .where(where(membershipRequests, eq(membershipRequests.id, requestId)))
          .limit(1),
      );
    },

    listPendingJoinRequests(limit) {
      return tx
        .select({
          request: membershipRequests,
          name: users.name,
          username: users.username,
          image: users.image,
          email: users.email,
        })
        .from(membershipRequests)
        .innerJoin(users, eq(users.id, membershipRequests.userId))
        .where(where(membershipRequests, eq(membershipRequests.status, "pending")))
        .orderBy(asc(membershipRequests.createdAt), asc(membershipRequests.id))
        .limit(limit);
    },

    countPendingJoinRequests() {
      return countOf(
        tx
          .select({ value: count() })
          .from(membershipRequests)
          .where(where(membershipRequests, eq(membershipRequests.status, "pending"))),
      );
    },

    async decideJoinRequest(requestId, decision) {
      return first(
        await tx
          .update(membershipRequests)
          .set({
            status: decision.status,
            decisionNote: decision.note,
            decidedBy: decision.decidedBy,
            decidedAt: decision.decidedAt,
            updatedAt: decision.decidedAt,
          })
          .where(
            where(
              membershipRequests,
              eq(membershipRequests.id, requestId),
              eq(membershipRequests.status, "pending"),
            ),
          )
          .returning(),
      );
    },
  };
}
