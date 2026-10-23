import {
  newId,
  runInCommunity,
  setRlsFlag,
  withCommunity,
  type CommunityId,
  type Database,
} from "@cohory/db";
import {
  membershipPlans,
  paymentConnections,
  paymentCustomers,
  subscriptions,
  type SubscriptionAccessState,
} from "@cohory/db/schema";
import { eq } from "drizzle-orm";

export async function subscribe(
  db: Database,
  communityId: CommunityId,
  userId: string,
  periodEnd: Date,
): Promise<string> {
  return runInCommunity(withCommunity(db, communityId), async ({ tx, values }) => {
    await setRlsFlag(tx, "payments_manager");
    const [existing] = await tx
      .select({ id: paymentConnections.id })
      .from(paymentConnections)
      .where(eq(paymentConnections.communityId, communityId));
    const [connection] = existing
      ? [existing]
      : await tx
          .insert(paymentConnections)
          .values(values({ provider: "stripe_connect" as const, status: "active" as const }))
          .returning({ id: paymentConnections.id });
    if (!connection) throw new Error("no connection");
    const [customer] = await tx
      .insert(paymentCustomers)
      .values(values({ userId, connectionId: connection.id, externalCustomerId: `cus_${newId()}` }))
      .returning({ id: paymentCustomers.id });
    if (!customer) throw new Error("no customer");
    const [subscription] = await tx
      .insert(subscriptions)
      .values(
        values({
          userId,
          customerId: customer.id,
          connectionId: connection.id,
          externalSubscriptionId: `sub_${newId()}`,
          providerStatus: "active",
          accessState: "granted" as const,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          applicationFeeBps: 200,
          providerFetchedAt: periodEnd,
        }),
      )
      .returning({ id: subscriptions.id });
    if (!subscription) throw new Error("no subscription");
    await tx
      .insert(membershipPlans)
      .values(
        values({
          name: "Plan",
          currency: "usd",
          monthlyPriceMinor: 1000,
          connectionId: connection.id,
        }),
      )
      .onConflictDoNothing();
    return subscription.id;
  });
}

export async function setSubscription(
  db: Database,
  communityId: CommunityId,
  subscriptionId: string,
  patch: {
    providerStatus: string;
    accessState: SubscriptionAccessState;
    currentPeriodEnd?: Date;
  },
): Promise<void> {
  await runInCommunity(withCommunity(db, communityId), async ({ tx, where }) => {
    await setRlsFlag(tx, "payments_manager");
    const updated = await tx
      .update(subscriptions)
      .set(patch)
      .where(where(subscriptions, eq(subscriptions.id, subscriptionId)))
      .returning({ id: subscriptions.id });
    if (updated.length !== 1) throw new Error("subscription not updated");
  });
}

export async function closeBilling(
  db: Database,
  communityId: CommunityId,
  closedAt: Date,
): Promise<void> {
  await runInCommunity(withCommunity(db, communityId), async ({ tx, where }) => {
    await setRlsFlag(tx, "payments_manager");
    await tx
      .update(paymentConnections)
      .set({ status: "disconnected", disconnectedAt: closedAt })
      .where(where(paymentConnections, eq(paymentConnections.communityId, communityId)));
  });
}
