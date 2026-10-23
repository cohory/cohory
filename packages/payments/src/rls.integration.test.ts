import { newId, type Database } from "@cohory/db";
import {
  compedMemberships,
  feeLedgerEntries,
  paymentConnections,
  paymentCustomers,
  providerEvents,
  subscriptionLinks,
  subscriptions,
} from "@cohory/db/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { insertCommunity, insertUser, openProbeDb, openTestDb } from "./test/fixtures";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface Settings {
  community?: string;
  user?: string;
  manager?: boolean;
  webhook?: boolean;
}

function asProbe<T>(settings: Settings, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return probe.db.transaction(async (tx) => {
    const set = async (name: string, value: string | undefined) => {
      if (value) await tx.execute(sql`select set_config(${name}, ${value}, true)`);
    };
    await set("app.community_id", settings.community);
    await set("app.user_id", settings.user);
    await set("app.payments_manager", settings.manager ? "on" : undefined);
    await set("app.payments_webhook", settings.webhook ? "on" : undefined);
    return fn(tx);
  });
}

async function seed() {
  const communityId = await insertCommunity(admin.db);
  const buyerId = await insertUser(admin.db);
  const otherId = await insertUser(admin.db);
  const [connection] = await admin.db
    .insert(paymentConnections)
    .values({
      communityId,
      provider: "stripe_connect",
      status: "active",
      externalAccountId: `acct_rls${newId().slice(-8)}`,
    })
    .returning();
  const connectionId = connection?.id ?? "";
  const insertSub = async (userId: string) => {
    const [customer] = await admin.db
      .insert(paymentCustomers)
      .values({ communityId, userId, connectionId, externalCustomerId: `cus_${newId()}` })
      .returning();
    await admin.db.insert(subscriptions).values({
      communityId,
      userId,
      customerId: customer?.id ?? "",
      connectionId,
      externalSubscriptionId: `sub_${newId()}`,
      providerStatus: "active",
      accessState: "granted",
      applicationFeeBps: 200,
      providerFetchedAt: new Date(),
    });
  };
  await insertSub(buyerId);
  await insertSub(otherId);
  return { communityId, buyerId, otherId, connectionId };
}

function ledgerRow(communityId: string) {
  return {
    communityId,
    kind: "fee_collected" as const,
    provider: "stripe_connect" as const,
    collectionMethod: "automatic_split" as const,
    currency: "usd",
    baseMinor: 4900,
    rateBps: 200,
    computedFeeMinor: 49,
    providerFeeMinor: 49,
    idempotencyKey: `fee:collected:${newId()}`,
    occurredAt: new Date(),
  };
}

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

describe("payments row level security", () => {
  it("keeps subscription links to the community's managers", async () => {
    const { communityId, buyerId, connectionId } = await seed();
    const other = await seed();
    await admin.db.insert(subscriptionLinks).values({
      communityId,
      connectionId,
      externalSubscriptionId: `sub_link${newId()}`,
      externalCustomerId: `cus_link${newId()}`,
      email: "linked@example.test",
      interval: "month",
      status: "invited",
    });
    const read = (settings: Settings) =>
      asProbe(settings, (tx) =>
        tx
          .select({ id: subscriptionLinks.id })
          .from(subscriptionLinks)
          .where(eq(subscriptionLinks.communityId, communityId)),
      );

    expect(await read({ community: communityId, user: buyerId })).toHaveLength(0);
    expect(await read({ community: other.communityId, manager: true })).toHaveLength(0);
    expect(await read({ community: communityId, manager: true })).toHaveLength(1);
    await expect(
      asProbe({ community: communityId, user: buyerId }, (tx) =>
        tx.insert(subscriptionLinks).values({
          communityId,
          connectionId,
          externalSubscriptionId: `sub_link${newId()}`,
          externalCustomerId: `cus_link${newId()}`,
          email: "forged@example.test",
          interval: "month",
          status: "invited",
        }),
      ),
    ).rejects.toThrow();
  });

  it("is enabled and forced on every payments table", async () => {
    const result = await admin.db.execute<{ relname: string; enabled: boolean; forced: boolean }>(
      sql`select relname, relrowsecurity as enabled, relforcerowsecurity as forced from pg_class
          where relname in ('payment_connections', 'membership_plans', 'payment_customers',
            'subscriptions', 'payments', 'fee_ledger_entries', 'provider_events',
            'subscription_links')
          order by relname`,
    );
    expect(result.rows).toHaveLength(8);
    for (const row of result.rows) {
      expect(row).toMatchObject({ enabled: true, forced: true });
    }
  });

  it("shows members only their own subscription and managers all of them", async () => {
    const { communityId, buyerId } = await seed();

    const own = await asProbe({ community: communityId, user: buyerId }, (tx) =>
      tx.select().from(subscriptions).where(eq(subscriptions.communityId, communityId)),
    );
    const managed = await asProbe({ community: communityId, manager: true }, (tx) =>
      tx.select().from(subscriptions).where(eq(subscriptions.communityId, communityId)),
    );
    const unscoped = await asProbe({ manager: true }, (tx) =>
      tx.select().from(subscriptions).where(eq(subscriptions.communityId, communityId)),
    );
    const ownAnywhere = await asProbe({ user: buyerId, manager: true }, (tx) =>
      tx.select().from(subscriptions).where(eq(subscriptions.communityId, communityId)),
    );

    expect(own.map((row) => row.userId)).toEqual([buyerId]);
    expect(managed).toHaveLength(2);
    expect(unscoped).toEqual([]);
    expect(ownAnywhere.map((row) => row.userId)).toEqual([buyerId]);
  });

  it("shows comped access to its member and to payments managers, and lets only managers or the expiry job change it", async () => {
    const communityId = await insertCommunity(admin.db);
    const other = await insertCommunity(admin.db);
    const compedId = await insertUser(admin.db);
    const bystanderId = await insertUser(admin.db);
    await admin.db.insert(compedMemberships).values({ communityId, userId: compedId });
    await admin.db.insert(compedMemberships).values({ communityId, userId: bystanderId });
    const rows = (settings: Settings, where = eq(compedMemberships.communityId, communityId)) =>
      asProbe(settings, (tx) => tx.select().from(compedMemberships).where(where));

    expect((await rows({ community: communityId, user: compedId })).map((r) => r.userId)).toEqual([
      compedId,
    ]);
    expect(await rows({ community: communityId, manager: true })).toHaveLength(2);
    expect(await rows({ community: other, manager: true })).toEqual([]);
    expect(await rows({ user: compedId })).toEqual([]);
    expect(await rows({ webhook: true }, undefined)).toEqual(expect.any(Array));
    expect((await rows({ webhook: true })).length).toBe(2);

    await expect(
      asProbe({ community: communityId, user: bystanderId }, (tx) =>
        tx.insert(compedMemberships).values({ communityId, userId: bystanderId, note: "mine" }),
      ),
    ).rejects.toSatisfy((error: unknown) =>
      /row-level security/.test(String(error instanceof Error ? (error.cause ?? error) : error)),
    );
    const touched = await asProbe({ community: communityId, user: compedId }, (tx) =>
      tx
        .update(compedMemberships)
        .set({ expiresAt: null })
        .where(eq(compedMemberships.userId, bystanderId))
        .returning({ id: compedMemberships.id }),
    );
    expect(touched).toEqual([]);
    const ended = await asProbe({ community: communityId, manager: true }, (tx) =>
      tx
        .update(compedMemberships)
        .set({ endedAt: new Date(), endReason: "revoked" })
        .where(eq(compedMemberships.userId, bystanderId))
        .returning({ id: compedMemberships.id }),
    );
    expect(ended).toHaveLength(1);
  });

  it("hides one community's subscriptions from another community's managers", async () => {
    const first = await seed();
    const second = await seed();
    const rows = await asProbe({ community: second.communityId, manager: true }, (tx) =>
      tx.select().from(subscriptions).where(eq(subscriptions.communityId, first.communityId)),
    );
    expect(rows).toEqual([]);
  });

  it("keeps the fee ledger append only", async () => {
    const { communityId } = await seed();
    await asProbe({ community: communityId, manager: true }, (tx) =>
      tx.insert(feeLedgerEntries).values(ledgerRow(communityId)),
    );

    const updated = await asProbe({ community: communityId, manager: true }, (tx) =>
      tx
        .update(feeLedgerEntries)
        .set({ computedFeeMinor: 0 })
        .where(eq(feeLedgerEntries.communityId, communityId))
        .returning(),
    );
    const deleted = await asProbe({ community: communityId, manager: true }, (tx) =>
      tx.delete(feeLedgerEntries).where(eq(feeLedgerEntries.communityId, communityId)).returning(),
    );
    const remaining = await admin.db
      .select()
      .from(feeLedgerEntries)
      .where(eq(feeLedgerEntries.communityId, communityId));

    expect(updated).toEqual([]);
    expect(deleted).toEqual([]);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.computedFeeMinor).toBe(49);
  });

  it("rejects ledger writes without the manager flag", async () => {
    const { communityId } = await seed();
    await expect(
      asProbe({ community: communityId }, (tx) =>
        tx.insert(feeLedgerEntries).values(ledgerRow(communityId)),
      ),
    ).rejects.toThrow();
  });

  it("rejects connection changes without the manager flag", async () => {
    const { communityId, connectionId } = await seed();
    const changed = await asProbe({ community: communityId }, (tx) =>
      tx
        .update(paymentConnections)
        .set({ chargesEnabled: false })
        .where(eq(paymentConnections.id, connectionId))
        .returning(),
    );
    expect(changed).toEqual([]);
  });

  it("finds a connection by account only for webhook processing", async () => {
    const { connectionId } = await seed();
    const [row] = await admin.db
      .select()
      .from(paymentConnections)
      .where(eq(paymentConnections.id, connectionId));
    const accountId = row?.externalAccountId ?? "";
    const plain = await asProbe({}, (tx) =>
      tx
        .select()
        .from(paymentConnections)
        .where(eq(paymentConnections.externalAccountId, accountId)),
    );
    const webhook = await asProbe({ webhook: true }, (tx) =>
      tx
        .select()
        .from(paymentConnections)
        .where(eq(paymentConnections.externalAccountId, accountId)),
    );
    expect(plain).toEqual([]);
    expect(webhook).toHaveLength(1);
  });

  it("keeps the webhook inbox private to webhook processing", async () => {
    const externalEventId = `evt_${newId()}`;
    await asProbe({ webhook: true }, (tx) =>
      tx.insert(providerEvents).values({
        provider: "stripe_connect",
        externalEventId,
        type: "invoice.paid",
        livemode: false,
        payloadHash: "x",
      }),
    );
    const plain = await asProbe({ manager: true }, (tx) =>
      tx.select().from(providerEvents).where(eq(providerEvents.externalEventId, externalEventId)),
    );
    expect(plain).toEqual([]);
    await expect(
      asProbe({}, (tx) =>
        tx.insert(providerEvents).values({
          provider: "stripe_connect",
          externalEventId: `evt_${newId()}`,
          type: "invoice.paid",
          livemode: false,
          payloadHash: "x",
        }),
      ),
    ).rejects.toThrow();
  });
});
