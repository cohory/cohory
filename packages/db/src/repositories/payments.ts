import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import {
  communities,
  compedMemberships,
  feeLedgerEntries,
  membershipPlans,
  paymentConnections,
  payments,
  subscriptions,
} from "../schema";
import type { ScopedQueries } from "../tenancy/scope";
import { withRlsFlags } from "../tenancy/session";

// Payment is the approval in a paid community (decision 0037), so selling a plan turns
// "approval" into open joining. Invite only stays: it still limits who may buy.
const openWhenApproval = sql<
  "open" | "invite"
>`case when ${communities.joinMode} = 'approval' then 'open'::join_mode else ${communities.joinMode} end`;

export async function markTestCheckoutSucceeded(
  { tx, communityId }: Pick<ScopedQueries, "tx" | "communityId">,
  at: Date,
): Promise<void> {
  await tx
    .update(communities)
    .set({ testCheckoutSucceededAt: at })
    .where(and(eq(communities.id, communityId), isNull(communities.testCheckoutSucceededAt)));
}

export async function setCommunityCurrency(
  { tx, communityId }: Pick<ScopedQueries, "tx" | "communityId">,
  currency: string | null,
): Promise<void> {
  await tx
    .update(communities)
    .set({
      currency,
      ...(currency === null ? {} : { joinMode: openWhenApproval }),
      updatedAt: new Date(),
    })
    .where(eq(communities.id, communityId));
}

type Queries = Pick<ScopedQueries, "tx" | "where">;

async function paidRowSince({ tx, where }: Queries, since: Date): Promise<boolean> {
  const [payment] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      where(
        payments,
        gte(payments.occurredAt, since),
        gt(payments.amountMinor, payments.refundedMinor),
      ),
    )
    .limit(1);
  if (payment) {
    return true;
  }
  const [entry] = await tx
    .select({ id: feeLedgerEntries.id })
    .from(feeLedgerEntries)
    .leftJoin(payments, eq(payments.id, feeLedgerEntries.paymentId))
    .where(
      where(
        feeLedgerEntries,
        gte(feeLedgerEntries.occurredAt, since),
        inArray(feeLedgerEntries.kind, ["fee_accrued", "fee_collected"]),
        gt(feeLedgerEntries.baseMinor, 0),
        or(isNull(feeLedgerEntries.paymentId), gt(payments.amountMinor, payments.refundedMinor)),
      ),
    )
    .limit(1);
  return entry !== undefined;
}

export async function hasPaidTransactionSince(queries: Queries, since: Date): Promise<boolean> {
  return withRlsFlags(queries.tx, ["payments_manager"], () => paidRowSince(queries, since));
}

export type Subscription = typeof subscriptions.$inferSelect;

export async function findSubscriptionForUserIn(
  { tx, where }: Queries,
  userId: string,
): Promise<Subscription | null> {
  const [row] = await tx
    .select()
    .from(subscriptions)
    .where(where(subscriptions, eq(subscriptions.userId, userId)))
    .orderBy(
      sql`case ${subscriptions.accessState} when 'granted' then 0 when 'grace' then 1 when 'none' then 2 else 3 end`,
      subscriptions.cancelAtPeriodEnd,
      desc(subscriptions.updatedAt),
    )
    .limit(1);
  return row ?? null;
}

export async function findConnectionClosedAtIn(
  { tx, where }: Queries,
  connectionId: string,
): Promise<Date | null> {
  const [row] = await tx
    .select({ closedAt: paymentConnections.disconnectedAt })
    .from(paymentConnections)
    .where(
      where(
        paymentConnections,
        eq(paymentConnections.id, connectionId),
        eq(paymentConnections.status, "disconnected"),
      ),
    )
    .limit(1);
  return row?.closedAt ?? null;
}

export async function findOpenCompIn(
  { tx, where }: Queries,
  userId: string,
): Promise<{ expiresAt: Date | null } | null> {
  const [row] = await tx
    .select({ expiresAt: compedMemberships.expiresAt })
    .from(compedMemberships)
    .where(
      where(
        compedMemberships,
        eq(compedMemberships.userId, userId),
        isNull(compedMemberships.endedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function hasActivePlanIn({ tx, where }: Queries): Promise<boolean> {
  const [row] = await tx
    .select({ id: membershipPlans.id })
    .from(membershipPlans)
    .where(
      where(
        membershipPlans,
        isNull(membershipPlans.archivedAt),
        isNotNull(membershipPlans.connectionId),
      ),
    )
    .limit(1);
  return row !== undefined;
}
