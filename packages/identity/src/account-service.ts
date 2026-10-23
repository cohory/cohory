import { assertCan, UnauthenticatedError, type Actor } from "@cohory/authz";
import { getDb, type Database, type Transaction } from "@cohory/db";
import { paidCommunityBlockers, type PaidCommunityBlockers } from "@cohory/payments/account";
import { sessions, users } from "@cohory/db/schema";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";

import {
  AccountConfirmationError,
  AccountDeletionBlockedError,
  AccountNotFoundError,
  type OwnedCommunity,
} from "./errors";
import { actAsUser, audit, blockingCommunities } from "./queries";
import { describeUserAgent } from "./user-agent";

export const deletionGraceDays = 14;
const dayMs = 24 * 60 * 60 * 1000;

export interface AccountServiceDeps {
  readonly db: Database;
  readonly now?: () => Date;
  readonly paidCommunityBlockers?: PaidCommunityBlockers;
}

export interface DeletionStatus {
  readonly scheduledFor: Date | null;
}

export interface SessionView {
  readonly id: string;
  readonly device: string;
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
  readonly current: boolean;
}

function requireUserId(actor: Actor): string {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  assertCan(actor, "update_own", "account");
  return actor.userId;
}

export function confirmationMatches(email: string, typed: string): boolean {
  return typed.trim().toLowerCase() === email.trim().toLowerCase();
}

export function createAccountService(deps: AccountServiceDeps) {
  const now = deps.now ?? (() => new Date());

  function asUser<T>(actor: Actor, fn: (tx: Transaction, userId: string) => Promise<T>) {
    const userId = requireUserId(actor);
    return deps.db.transaction(async (tx) => {
      await actAsUser(tx, userId);
      return fn(tx, userId);
    });
  }

  return {
    async ownedCommunities(actor: Actor): Promise<OwnedCommunity[]> {
      return asUser(actor, (tx, userId) =>
        blockingCommunities(tx, userId, deps.paidCommunityBlockers),
      );
    },

    async deletionStatus(actor: Actor): Promise<DeletionStatus> {
      return asUser(actor, async (tx, userId) => {
        const [row] = await tx
          .select({ scheduledFor: users.deletionScheduledFor })
          .from(users)
          .where(eq(users.id, userId));
        return { scheduledFor: row?.scheduledFor ?? null };
      });
    },

    async requestDeletion(actor: Actor, input: { confirmation: string }): Promise<DeletionStatus> {
      return asUser(actor, async (tx, userId) => {
        const [user] = await tx
          .select({ email: users.email })
          .from(users)
          .where(and(eq(users.id, userId), isNull(users.erasedAt)))
          .for("update");
        if (!user) {
          throw new AccountNotFoundError();
        }
        if (!confirmationMatches(user.email, input.confirmation)) {
          throw new AccountConfirmationError();
        }
        const owned = await blockingCommunities(tx, userId, deps.paidCommunityBlockers);
        if (owned.length > 0) {
          throw new AccountDeletionBlockedError(owned);
        }
        const at = now();
        const scheduledFor = new Date(at.getTime() + deletionGraceDays * dayMs);
        await tx
          .update(users)
          .set({ deletionRequestedAt: at, deletionScheduledFor: scheduledFor })
          .where(eq(users.id, userId));
        const revoked = await tx
          .delete(sessions)
          .where(eq(sessions.userId, userId))
          .returning({ id: sessions.id });
        await audit(
          tx,
          userId,
          "account.deletion_requested",
          { scheduledFor: scheduledFor.toISOString(), sessionsRevoked: revoked.length },
          at,
        );
        return { scheduledFor };
      });
    },

    async cancelDeletion(actor: Actor): Promise<void> {
      await asUser(actor, async (tx, userId) => {
        const cancelled = await tx
          .update(users)
          .set({ deletionRequestedAt: null, deletionScheduledFor: null })
          .where(
            and(
              eq(users.id, userId),
              isNull(users.erasedAt),
              sql`${users.deletionScheduledFor} is not null`,
            ),
          )
          .returning({ id: users.id });
        if (cancelled.length > 0) {
          await audit(tx, userId, "account.deletion_cancelled", null, now());
        }
      });
    },

    async listSessions(actor: Actor, currentSessionId: string): Promise<SessionView[]> {
      return asUser(actor, async (tx, userId) => {
        const rows = await tx
          .select({
            id: sessions.id,
            userAgent: sessions.userAgent,
            createdAt: sessions.createdAt,
            updatedAt: sessions.updatedAt,
          })
          .from(sessions)
          .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now())))
          .orderBy(desc(sessions.updatedAt));
        const views = rows.map((row) => ({
          id: row.id,
          device: describeUserAgent(row.userAgent),
          createdAt: row.createdAt,
          lastActiveAt: row.updatedAt,
          current: row.id === currentSessionId,
        }));
        return [...views.filter((view) => view.current), ...views.filter((view) => !view.current)];
      });
    },

    async revokeSession(actor: Actor, sessionId: string): Promise<boolean> {
      return asUser(actor, async (tx, userId) => {
        const revoked = await tx
          .delete(sessions)
          .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
          .returning({ id: sessions.id });
        if (revoked.length > 0) {
          await audit(tx, userId, "session.revoked", { count: 1 }, now());
        }
        return revoked.length > 0;
      });
    },

    async revokeOtherSessions(actor: Actor, currentSessionId: string): Promise<number> {
      return asUser(actor, async (tx, userId) => {
        const revoked = await tx
          .delete(sessions)
          .where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)))
          .returning({ id: sessions.id });
        if (revoked.length > 0) {
          await audit(tx, userId, "session.revoked", { count: revoked.length }, now());
        }
        return revoked.length;
      });
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;

let defaultService: AccountService | undefined;

export function getAccountService(): AccountService {
  defaultService ??= createAccountService({
    db: getDb(),
    paidCommunityBlockers: paidCommunityBlockers(),
  });
  return defaultService;
}
