import type { Database } from "@cohory/db";
import { accounts, sessions, verifications } from "@cohory/db/schema";
import { and, eq, ne } from "drizzle-orm";

const markerLifetimeMs = 365 * 24 * 60 * 60 * 1000;

function markerFor(userId: string): string {
  return `unproven-password:${userId}`;
}

export interface UnprovenPasswordDeps {
  readonly revokeBearerCredentials: (userId: string) => Promise<void>;
  readonly notifyPasswordRemoved: (userId: string) => Promise<void>;
  readonly now?: () => Date;
}

// Users, sessions, accounts, and verifications are global auth tables with no community scope.
export function createUnprovenPasswordGuard(db: Database, deps: UnprovenPasswordDeps) {
  const now = deps.now ?? (() => new Date());

  async function hasMarker(userId: string): Promise<boolean> {
    const rows = await db
      .select({ id: verifications.id })
      .from(verifications)
      .where(eq(verifications.identifier, markerFor(userId)))
      .limit(1);
    return rows.length > 0;
  }

  async function clear(userId: string): Promise<void> {
    await db.delete(verifications).where(eq(verifications.identifier, markerFor(userId)));
  }

  return {
    // Confirming the mailbox does not prove who chose the password, so it stays suspect until a
    // reset or a magic link shows the mailbox owner is the one signing in.
    async markIfPasswordSet(userId: string): Promise<void> {
      const credential = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")))
        .limit(1);
      if (credential.length === 0 || (await hasMarker(userId))) {
        return;
      }
      await db.insert(verifications).values({
        identifier: markerFor(userId),
        value: "credential",
        expiresAt: new Date(now().getTime() + markerLifetimeMs),
      });
    },

    clear,

    async removeAfterMagicLink(userId: string, keepSessionId: string): Promise<void> {
      if (!(await hasMarker(userId))) {
        return;
      }
      await db
        .delete(accounts)
        .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")));
      await signOutOtherDevices(db, userId, keepSessionId);
      await deps.revokeBearerCredentials(userId);
      await clear(userId);
      await deps.notifyPasswordRemoved(userId);
    },
  };
}

export async function signOutOtherDevices(
  db: Database,
  userId: string,
  keepSessionId: string,
): Promise<void> {
  await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)));
}
