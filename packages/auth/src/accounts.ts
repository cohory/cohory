import type { Database } from "@cohory/db";
import { accountAuditLog, users } from "@cohory/db/schema";
import { and, count, eq, lt, max, min } from "drizzle-orm";
import { setRlsValue } from "@cohory/db";

export interface UnverifiedAccounts {
  readonly count: number;
  readonly earliestCreatedAt: Date | null;
  readonly latestCreatedAt: Date | null;
}

function unverifiedBefore(createdBefore: Date) {
  return and(eq(users.emailVerified, false), lt(users.createdAt, createdBefore));
}

// Users are global, not community data, so these queries have no community scope.
export async function summarizeUnverifiedAccounts(
  db: Database,
  createdBefore: Date,
): Promise<UnverifiedAccounts> {
  const [row] = await db
    .select({
      count: count(),
      earliestCreatedAt: min(users.createdAt),
      latestCreatedAt: max(users.createdAt),
    })
    .from(users)
    .where(unverifiedBefore(createdBefore));
  return {
    count: row?.count ?? 0,
    earliestCreatedAt: row?.earliestCreatedAt ?? null,
    latestCreatedAt: row?.latestCreatedAt ?? null,
  };
}

export async function markUnverifiedAccountsVerified(
  db: Database,
  createdBefore: Date,
): Promise<UnverifiedAccounts> {
  return db.transaction(async (tx) => {
    const marked = await tx
      .update(users)
      .set({ emailVerified: true })
      .where(unverifiedBefore(createdBefore))
      .returning({ id: users.id, createdAt: users.createdAt });
    const metadata = { via: "accounts-cli", createdBefore: createdBefore.toISOString() };
    for (const { id } of marked) {
      // The audit log only accepts rows for the user named in app.user_id.
      await setRlsValue(tx, "user_id", id);
      await tx
        .insert(accountAuditLog)
        .values({ userId: id, action: "account.email_marked_verified", metadata });
    }
    let earliestCreatedAt: Date | null = null;
    let latestCreatedAt: Date | null = null;
    for (const { createdAt } of marked) {
      if (!earliestCreatedAt || createdAt < earliestCreatedAt) earliestCreatedAt = createdAt;
      if (!latestCreatedAt || createdAt > latestCreatedAt) latestCreatedAt = createdAt;
    }
    return { count: marked.length, earliestCreatedAt, latestCreatedAt };
  });
}
