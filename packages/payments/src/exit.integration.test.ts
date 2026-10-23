import { communityIdSchema, type CommunityId, type Database } from "@cohory/db";
import {
  communities,
  feeLedgerEntries,
  paymentConnections,
  payments,
  platformBillingAccounts,
  platformInvoiceLines,
  platformInvoices,
} from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresBillingRepository } from "./billing/postgres-store";
import { ExitInProgressError } from "./errors";
import { createPostgresPaymentsRepository } from "./postgres-repository";
import type { PaymentsRepository } from "./repository";
import { insertCommunity, insertMember, openProbeDb, openTestDb } from "./test/fixtures";
import { createHarness, mirrorSubscription, setupPaidCommunity } from "./test/harness";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };
let repo: PaymentsRepository;

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
  repo = createPostgresPaymentsRepository(probe.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

async function paidCommunity(): Promise<{ communityId: CommunityId; connectionId: string }> {
  const paid = await setupPaidCommunity(admin.db, createHarness(admin.db));
  const [connection] = await admin.db
    .select({ id: paymentConnections.id })
    .from(paymentConnections)
    .where(eq(paymentConnections.communityId, paid.communityId));
  return { communityId: paid.communityId, connectionId: connection?.id ?? "" };
}

async function closedConnection(communityId: CommunityId, disconnectedAt: Date): Promise<string> {
  const [row] = await admin.db
    .insert(paymentConnections)
    .values({
      communityId,
      provider: "stripe_connect",
      status: "disconnected",
      externalAccountId: `acct_closed${communityId.slice(-8)}${disconnectedAt.getTime()}`,
      disconnectedAt,
    })
    .returning({ id: paymentConnections.id });
  return row?.id ?? "";
}

async function seedFinancialRecords(communityId: CommunityId, invoiceStatus: "paid" | "open") {
  const [payment] = await admin.db
    .insert(payments)
    .values({
      communityId,
      externalInvoiceId: `in_exit${crypto.randomUUID()}`,
      currency: "usd",
      amountMinor: 4900,
      occurredAt: new Date("2026-09-15T00:00:00Z"),
    })
    .returning({ id: payments.id });
  const [entry] = await admin.db
    .insert(feeLedgerEntries)
    .values({
      communityId,
      paymentId: payment?.id ?? null,
      kind: "fee_accrued",
      provider: "stripe_own_keys",
      collectionMethod: "periodic_invoice",
      currency: "usd",
      baseMinor: 4900,
      rateBps: 200,
      computedFeeMinor: 49,
      idempotencyKey: `fee:exit:${crypto.randomUUID()}`,
      occurredAt: new Date("2026-09-15T00:00:00Z"),
    })
    .returning({ id: feeLedgerEntries.id });
  const [account] = await admin.db
    .insert(platformBillingAccounts)
    .values({ communityId })
    .returning({ id: platformBillingAccounts.id });
  const [invoice] = await admin.db
    .insert(platformInvoices)
    .values({
      communityId,
      billingAccountId: account?.id ?? "",
      currency: "usd",
      periodStart: new Date("2026-09-01T00:00:00Z"),
      periodEnd: new Date("2026-10-01T00:00:00Z"),
      amountMinor: 49,
      status: invoiceStatus,
      collectionMethod: "charge_automatically",
    })
    .returning({ id: platformInvoices.id });
  await admin.db.insert(platformInvoiceLines).values({
    communityId,
    invoiceId: invoice?.id ?? "",
    ledgerEntryId: entry?.id ?? "",
    amountMinor: 49,
  });
  return {
    paymentId: payment?.id ?? "",
    entryId: entry?.id ?? "",
    accountId: account?.id ?? "",
    invoiceId: invoice?.id ?? "",
  };
}

async function snapshotsOf(communityId: CommunityId) {
  const tables = [
    payments,
    feeLedgerEntries,
    platformBillingAccounts,
    platformInvoices,
    platformInvoiceLines,
  ] as const;
  const rows = await Promise.all(
    tables.map((table) =>
      admin.db
        .select({ id: table.formerCommunityId, name: table.formerCommunityName })
        .from(table)
        .where(eq(table.formerCommunityId, communityId)),
    ),
  );
  return rows.flat();
}

describe("exit store", () => {
  it("lists only active, trialing, past_due, and unpaid subscriptions of the connection", async () => {
    const paid = await paidCommunity();
    const eligible = await Promise.all(
      ["active", "trialing", "past_due", "unpaid"].map((providerStatus) =>
        mirrorSubscription(admin.db, paid.communityId, { providerStatus }),
      ),
    );
    await Promise.all(
      ["canceled", "incomplete", "incomplete_expired", "paused"].map((providerStatus) =>
        mirrorSubscription(admin.db, paid.communityId, { providerStatus, accessState: "revoked" }),
      ),
    );
    const oldConnection = await closedConnection(paid.communityId, new Date("2026-08-01"));
    const onOld = await mirrorSubscription(admin.db, paid.communityId, {
      connectionId: oldConnection,
    });

    const [onOpen, everywhere] = await repo.inCommunityAsSystem(paid.communityId, (store) =>
      Promise.all([
        store.exit.listExitSubscriptions(paid.connectionId),
        store.exit.listExitSubscriptions(null),
      ]),
    );

    expect(onOpen.map((row) => row.id).sort()).toEqual(eligible.map((row) => row.id).sort());
    expect(everywhere.map((row) => row.id).sort()).toEqual(
      [...eligible, onOld].map((row) => row.id).sort(),
    );
    expect(onOpen.find((row) => row.id === eligible[2]?.id)).toEqual({
      id: eligible[2]?.id,
      userId: eligible[2]?.userId,
      connectionId: paid.connectionId,
      externalSubscriptionId: eligible[2]?.externalSubscriptionId,
      origin: "created_by_cohory",
      providerStatus: "past_due",
      currentPeriodEnd: new Date("2026-11-18T10:00:00.000Z"),
      cancelAtPeriodEnd: false,
      applicationFeeBps: 200,
    });
  });

  it("counts linked imports apart from subscriptions created through Cohory", async () => {
    const paid = await paidCommunity();
    await mirrorSubscription(admin.db, paid.communityId);
    await mirrorSubscription(admin.db, paid.communityId, { providerStatus: "past_due" });
    await mirrorSubscription(admin.db, paid.communityId, { origin: "linked_import" });
    await mirrorSubscription(admin.db, paid.communityId, {
      origin: "linked_import",
      providerStatus: "canceled",
    });

    const counts = await repo.inCommunityAsSystem(paid.communityId, (store) =>
      store.exit.countExitSubscriptions(paid.connectionId),
    );
    const empty = await repo.inCommunityAsSystem(paid.communityId, (store) =>
      store.exit.countExitSubscriptions(crypto.randomUUID()),
    );

    expect(counts).toEqual({ cohory: 2, linkedImports: 1 });
    expect(empty).toEqual({ cohory: 0, linkedImports: 0 });
  });

  it("raises exit_in_progress when a second unfinished run is inserted", async () => {
    const paid = await paidCommunity();
    const newRun = (choice: "stop_at_period_end" | "keep_billing") => ({
      id: crypto.randomUUID(),
      kind: "archive" as const,
      choice,
      connectionId: paid.connectionId,
      includeLinked: true,
      requestedBy: null,
      portalLoginUrl: null,
      manualCancellationConfirmedAt: null,
      targetCount: 3,
    });

    const first = await repo.inCommunityAsSystem(paid.communityId, (store) =>
      store.exit.insertRun(newRun("stop_at_period_end")),
    );
    const second = repo.inCommunityAsSystem(paid.communityId, (store) =>
      store.exit.insertRun(newRun("keep_billing")),
    );

    await expect(second).rejects.toBeInstanceOf(ExitInProgressError);
    await expect(second).rejects.toMatchObject({ code: "exit_in_progress" });
    const state = await repo.inCommunityAsSystem(paid.communityId, async (store) => ({
      unfinished: await store.exit.findUnfinishedRun(),
      latest: await store.exit.latestRun("archive"),
      found: await store.exit.findRun(first.id),
    }));
    expect(state.unfinished?.id).toBe(first.id);
    expect(state.latest?.choice).toBe("stop_at_period_end");
    expect(state.found).toMatchObject({ status: "pending", targetCount: 3, attempts: 0 });

    const done = await repo.inCommunityAsSystem(paid.communityId, (store) =>
      store.exit.updateRun(first.id, {
        status: "done",
        attempts: 1,
        doneCount: 3,
        failedSubscriptionIds: [],
        finishedAt: new Date("2026-10-20T10:00:00Z"),
      }),
    );
    const next = await repo.inCommunityAsSystem(paid.communityId, (store) =>
      store.exit.insertRun(newRun("keep_billing")),
    );
    expect(done).toMatchObject({ status: "done", doneCount: 3 });
    expect(next.status).toBe("pending");
  });

  it("detaches payments, ledger entries, and platform invoices with the community name", async () => {
    const communityId = await insertCommunity(admin.db);
    const records = await seedFinancialRecords(communityId, "paid");

    const result = await repo.inCommunityAsSystem(communityId, (store) =>
      store.exit.detachFinancialRecords({ communityId, communityName: "Paid circle" }),
    );
    await admin.db.delete(communities).where(eq(communities.id, communityId));

    expect(result).toEqual({ payments: 1, ledgerEntries: 1, invoices: 1 });
    expect(await snapshotsOf(communityId)).toEqual(
      Array.from({ length: 5 }, () => ({ id: communityId, name: "Paid circle" })),
    );
    const [entry] = await admin.db
      .select()
      .from(feeLedgerEntries)
      .where(eq(feeLedgerEntries.id, records.entryId));
    expect(entry).toMatchObject({ communityId: null, computedFeeMinor: 49, rateBps: 200 });
  });

  it("detaches twice without changing the snapshot", async () => {
    const communityId = await insertCommunity(admin.db);
    await seedFinancialRecords(communityId, "paid");

    await repo.inCommunityAsSystem(communityId, (store) =>
      store.exit.detachFinancialRecords({ communityId, communityName: "Paid circle" }),
    );
    const again = await repo.inCommunityAsSystem(communityId, (store) =>
      store.exit.detachFinancialRecords({ communityId, communityName: "Renamed circle" }),
    );

    expect(again).toEqual({ payments: 1, ledgerEntries: 1, invoices: 1 });
    expect(new Set((await snapshotsOf(communityId)).map((row) => row.name))).toEqual(
      new Set(["Paid circle"]),
    );
  });

  it("refuses a snapshot for another community", async () => {
    const communityId = await insertCommunity(admin.db);
    const other = await insertCommunity(admin.db);
    await seedFinancialRecords(communityId, "paid");

    const attempt = repo.inCommunityAsSystem(communityId, (store) =>
      store.exit.detachFinancialRecords({ communityId: other, communityName: "Elsewhere" }),
    );

    await expect(attempt).rejects.toThrow("snapshot community does not match the store");
    expect(await snapshotsOf(other)).toEqual([]);
  });

  it("keeps detached records out of the billing sweeps", async () => {
    const communityId = await insertCommunity(admin.db);
    const records = await seedFinancialRecords(communityId, "open");
    await repo.inCommunityAsSystem(communityId, (store) =>
      store.exit.detachFinancialRecords({ communityId, communityName: "Paid circle" }),
    );
    await admin.db.delete(communities).where(eq(communities.id, communityId));
    const billing = createPostgresBillingRepository(probe.db);

    const [balances, unsettled, since, accounts] = await Promise.all([
      billing.listBillableBalances(new Date("2026-10-01T00:00:00Z")),
      billing.listUnsettledInvoices(),
      billing.listInvoicesSince(new Date("2026-09-01T00:00:00Z")),
      billing.listCommunitiesWithAccounts(),
    ]);

    expect(unsettled.map((row) => row.invoiceId)).not.toContain(records.invoiceId);
    expect(since.map((row) => row.invoiceId)).not.toContain(records.invoiceId);
    expect(balances.every((row) => communityIdSchema.safeParse(row.communityId).success)).toBe(
      true,
    );
    expect(accounts.every((id) => communityIdSchema.safeParse(id).success)).toBe(true);
  });

  it("returns the active owner's user id", async () => {
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");
    await insertMember(admin.db, communityId, "admin");
    const empty = await insertCommunity(admin.db);

    const found = await repo.inCommunityAsSystem(communityId, (store) => store.findOwnerId());
    const none = await repo.inCommunityAsSystem(empty, (store) => store.findOwnerId());

    expect(found).toBe(ownerId);
    expect(none).toBeNull();
  });

  it("lists subscriptions on disconnected connections that still grant access", async () => {
    const paid = await paidCommunity();
    const closedAt = new Date("2026-09-01T00:00:00Z");
    const now = new Date("2026-10-20T00:00:00Z");
    const closed = await closedConnection(paid.communityId, closedAt);
    const ended = await mirrorSubscription(admin.db, paid.communityId, {
      connectionId: closed,
      currentPeriodEnd: new Date("2026-10-01T00:00:00Z"),
    });
    const grace = await mirrorSubscription(admin.db, paid.communityId, {
      connectionId: closed,
      providerStatus: "past_due",
      accessState: "grace",
      currentPeriodEnd: null,
    });
    await mirrorSubscription(admin.db, paid.communityId, {
      connectionId: closed,
      currentPeriodEnd: new Date("2026-11-01T00:00:00Z"),
    });
    await mirrorSubscription(admin.db, paid.communityId, {
      connectionId: closed,
      accessState: "revoked",
      providerStatus: "canceled",
      currentPeriodEnd: new Date("2026-09-15T00:00:00Z"),
    });
    await mirrorSubscription(admin.db, paid.communityId, {
      currentPeriodEnd: new Date("2026-10-01T00:00:00Z"),
    });

    const due = await repo.listClosedBillingDue(now, 500);

    const mine = due.filter((row) => row.communityId === paid.communityId);
    expect(mine).toEqual([
      {
        communityId: paid.communityId,
        subscriptionId: grace.id,
        userId: grace.userId,
        closedAt,
        currentPeriodEnd: null,
        accessState: "grace",
      },
      {
        communityId: paid.communityId,
        subscriptionId: ended.id,
        userId: ended.userId,
        closedAt,
        currentPeriodEnd: new Date("2026-10-01T00:00:00Z"),
        accessState: "granted",
      },
    ]);
  });

  it("never lists another community's subscriptions", async () => {
    const mine = await paidCommunity();
    const theirs = await paidCommunity();
    await mirrorSubscription(admin.db, mine.communityId);
    await mirrorSubscription(admin.db, theirs.communityId);
    await mirrorSubscription(admin.db, theirs.communityId, { origin: "linked_import" });

    const [all, foreign, counts] = await repo.inCommunityAsSystem(mine.communityId, (store) =>
      Promise.all([
        store.exit.listExitSubscriptions(null),
        store.exit.listExitSubscriptions(theirs.connectionId),
        store.exit.countExitSubscriptions(theirs.connectionId),
      ]),
    );

    expect(all).toHaveLength(1);
    expect(all[0]?.connectionId).toBe(mine.connectionId);
    expect(foreign).toEqual([]);
    expect(counts).toEqual({ cohory: 0, linkedImports: 0 });
  });
});
