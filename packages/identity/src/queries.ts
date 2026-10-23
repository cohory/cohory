import type { Transaction } from "@cohory/db";
import type { PaidCommunityBlockers } from "@cohory/payments/account";
import { accountAuditLog, communities, memberships } from "@cohory/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { setRlsValue } from "@cohory/db";

import type { OwnedCommunity } from "./errors";

export async function actAsUser(
  tx: Transaction,
  userId: string,
  communityId?: string,
): Promise<void> {
  await setRlsValue(tx, "user_id", userId);
  if (communityId) {
    await setRlsValue(tx, "community_id", communityId);
  }
}

async function ownedCommunityRows(tx: Transaction, userId: string) {
  return tx
    .select({
      id: communities.id,
      slug: communities.slug,
      name: communities.name,
      archivedAt: communities.archivedAt,
    })
    .from(memberships)
    .innerJoin(communities, eq(communities.id, memberships.communityId))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.role, "owner"),
        eq(memberships.status, "active"),
        isNull(communities.deletedAt),
      ),
    )
    .orderBy(asc(communities.name));
}

export async function blockingCommunities(
  tx: Transaction,
  userId: string,
  billing: PaidCommunityBlockers | undefined,
): Promise<OwnedCommunity[]> {
  const rows = await ownedCommunityRows(tx, userId);
  const archived = rows.filter((row) => row.archivedAt !== null).map((row) => row.id);
  const billingIds = billing && archived.length > 0 ? await billing(archived) : new Set<string>();
  return rows.flatMap((row): OwnedCommunity[] => {
    const base = { id: row.id, slug: row.slug, name: row.name };
    if (row.archivedAt === null) return [{ ...base, reason: "active" }];
    return billingIds.has(row.id) ? [{ ...base, reason: "billing" }] : [];
  });
}

export async function audit(
  tx: Transaction,
  userId: string,
  action: string,
  metadata: Record<string, unknown> | null,
  at: Date,
): Promise<void> {
  await tx.insert(accountAuditLog).values({ userId, action, metadata, createdAt: at });
}
