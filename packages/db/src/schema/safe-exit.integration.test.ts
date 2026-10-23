import { readFileSync } from "node:fs";

import { eq, inArray, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, createPool, parseAdminDatabaseEnv, type Database } from "../index";
import { newId } from "../ids";
import { migrationLockKey } from "../migrations";
import { insertUser, openTestDb } from "../test/fixtures";
import {
  communities,
  feeLedgerEntries,
  memberships,
  notifications,
  paymentConnections,
  paymentCustomers,
  paymentExitRuns,
  payments,
  platformBillingAccounts,
  platformInvoiceLines,
  platformInvoices,
  subscriptions,
} from "./index";

const probeRole = "cohory_safe_exit_probe";
const ownerRole = "cohory_safe_exit_owner";
const probeTables = [
  "communities",
  "memberships",
  "outbox",
  "notifications",
  "payment_connections",
  "payment_customers",
  "subscriptions",
  "payments",
  "fee_ledger_entries",
  "platform_billing_accounts",
  "platform_invoices",
  "platform_invoice_lines",
  "platform_billing_issues",
  "payment_exit_runs",
];

const admin = openTestDb();
const probeUrl = new URL(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
probeUrl.searchParams.set("options", `-c role=${probeRole}`);
const probePool = createPool(probeUrl.toString());
const probeDb = createDb(probePool);
const adminPool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface Settings {
  community?: string;
  user?: string;
  manager?: boolean;
  webhook?: boolean;
  billing?: boolean;
  detach?: boolean;
}

function asProbe<T>(settings: Settings, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return probeDb.transaction(async (tx) => {
    const set = async (name: string, value: string | undefined) => {
      if (value) await tx.execute(sql`select set_config(${name}, ${value}, true)`);
    };
    await set("app.community_id", settings.community);
    await set("app.user_id", settings.user);
    await set("app.payments_manager", settings.manager ? "on" : undefined);
    await set("app.payments_webhook", settings.webhook ? "on" : undefined);
    await set("app.platform_billing", settings.billing ? "on" : undefined);
    await set("app.payments_detach", settings.detach ? "on" : undefined);
    return fn(tx);
  });
}

function pgCause(error: unknown): { code?: string; constraint?: string } {
  const cause = error instanceof Error && "cause" in error ? error.cause : error;
  return typeof cause === "object" && cause !== null ? cause : {};
}

async function rejection(
  promise: Promise<unknown>,
): Promise<{ code?: string; constraint?: string }> {
  try {
    await promise;
  } catch (error: unknown) {
    return pgCause(error);
  }
  throw new Error("expected the statement to fail");
}

async function lockExclusivelyWithoutWaiting(
  client: PoolClient,
  tables: readonly string[],
): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    await client.query("savepoint take_locks");
    try {
      await client.query(`lock table ${tables.join(", ")} in access exclusive mode nowait`);
      await client.query("release savepoint take_locks");
      return;
    } catch (error: unknown) {
      await client.query("rollback to savepoint take_locks");
      if (pgCause(error).code !== "55P03" || Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function insertCommunity(name = "Paid garden"): Promise<string> {
  const [row] = await admin.db
    .insert(communities)
    .values({ slug: `exit-${newId().slice(-12)}`, name })
    .returning({ id: communities.id });
  if (!row) throw new Error("community insert returned no row");
  return row.id;
}

async function seedPaidCommunity(name = "Paid garden") {
  const communityId = await insertCommunity(name);
  const ownerId = await insertUser(admin.db);
  const memberId = await insertUser(admin.db);
  await admin.db.insert(memberships).values([
    { communityId, userId: ownerId, role: "owner", status: "active" },
    { communityId, userId: memberId, role: "member", status: "active" },
  ]);
  const [connection] = await admin.db
    .insert(paymentConnections)
    .values({
      communityId,
      provider: "stripe_connect",
      status: "active",
      externalAccountId: `acct_exit${newId().slice(-8)}`,
    })
    .returning();
  const connectionId = connection?.id ?? "";
  const [customer] = await admin.db
    .insert(paymentCustomers)
    .values({ communityId, userId: memberId, connectionId, externalCustomerId: `cus_${newId()}` })
    .returning();
  const [subscription] = await admin.db
    .insert(subscriptions)
    .values({
      communityId,
      userId: memberId,
      customerId: customer?.id ?? "",
      connectionId,
      externalSubscriptionId: `sub_${newId()}`,
      providerStatus: "active",
      accessState: "granted",
      applicationFeeBps: 200,
      providerFetchedAt: new Date(),
    })
    .returning();
  return { communityId, ownerId, memberId, connectionId, subscriptionId: subscription?.id ?? "" };
}

async function seedFinancialRecords(communityId: string, subscriptionId: string) {
  const [payment] = await admin.db
    .insert(payments)
    .values({
      communityId,
      subscriptionId,
      externalInvoiceId: `in_${newId()}`,
      currency: "usd",
      amountMinor: 4900,
      occurredAt: new Date(),
    })
    .returning();
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
      computedFeeMinor: 98,
      idempotencyKey: `fee:accrued:${newId()}`,
      occurredAt: new Date(),
    })
    .returning();
  const [account] = await admin.db
    .insert(platformBillingAccounts)
    .values({ communityId })
    .returning();
  const [invoice] = await admin.db
    .insert(platformInvoices)
    .values({
      communityId,
      billingAccountId: account?.id ?? "",
      currency: "usd",
      periodStart: new Date("2026-09-01T00:00:00Z"),
      periodEnd: new Date("2026-10-01T00:00:00Z"),
      amountMinor: 98,
      status: "paid",
      collectionMethod: "charge_automatically",
    })
    .returning();
  const [line] = await admin.db
    .insert(platformInvoiceLines)
    .values({
      communityId,
      invoiceId: invoice?.id ?? "",
      ledgerEntryId: entry?.id ?? "",
      amountMinor: 98,
    })
    .returning();
  return {
    paymentId: payment?.id ?? "",
    entryId: entry?.id ?? "",
    accountId: account?.id ?? "",
    invoiceId: invoice?.id ?? "",
    lineId: line?.id ?? "",
  };
}

const snapshotTables = [
  "payments",
  "fee_ledger_entries",
  "platform_billing_accounts",
  "platform_invoices",
  "platform_invoice_lines",
] as const;

async function detachAsAdmin(communityId: string, name: string): Promise<void> {
  for (const table of snapshotTables) {
    await admin.db.execute(
      sql`update ${sql.identifier(table)} set former_community_id = ${communityId}, former_community_name = ${name} where community_id = ${communityId}`,
    );
  }
}

function deleteCommunityAsTenant(communityId: string) {
  return asProbe({ community: communityId }, (tx) =>
    tx.delete(communities).where(eq(communities.id, communityId)).returning({ id: communities.id }),
  );
}

beforeAll(async () => {
  await admin.db.transaction(async (tx) => {
    await tx.execute(sql.raw(`select pg_advisory_xact_lock(${migrationLockKey})`));
    await tx.execute(
      sql.raw(`do $$ begin
        if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
          create role ${probeRole} nologin nosuperuser nobypassrls;
        end if;
        grant usage on schema public to ${probeRole};
        grant select, insert, update, delete on ${probeTables.join(", ")} to ${probeRole};
        if (not exists (select 1 from pg_roles where rolname = '${ownerRole}')) then
          create role ${ownerRole} nologin nosuperuser nobypassrls;
        end if;
        grant usage on schema public to ${ownerRole};
      end $$`),
    );
  });
});

afterAll(async () => {
  await probePool.end();
  await adminPool.end();
  await admin.close();
});

describe("migration 0029", () => {
  it("keeps payments and ledger rows after a detached community is deleted", async () => {
    const paid = await seedPaidCommunity("Garden that closed");
    const records = await seedFinancialRecords(paid.communityId, paid.subscriptionId);
    await detachAsAdmin(paid.communityId, "Garden that closed");

    const deleted = await deleteCommunityAsTenant(paid.communityId);

    expect(deleted).toEqual([{ id: paid.communityId }]);
    const [payment] = await admin.db
      .select()
      .from(payments)
      .where(eq(payments.id, records.paymentId));
    expect(payment).toMatchObject({
      communityId: null,
      subscriptionId: null,
      formerCommunityId: paid.communityId,
      formerCommunityName: "Garden that closed",
      amountMinor: 4900,
    });
    const [entry] = await admin.db
      .select()
      .from(feeLedgerEntries)
      .where(eq(feeLedgerEntries.id, records.entryId));
    expect(entry).toMatchObject({
      communityId: null,
      paymentId: records.paymentId,
      formerCommunityId: paid.communityId,
      computedFeeMinor: 98,
    });
    const kept = await Promise.all([
      admin.db
        .select({
          id: platformBillingAccounts.id,
          communityId: platformBillingAccounts.communityId,
        })
        .from(platformBillingAccounts)
        .where(eq(platformBillingAccounts.id, records.accountId)),
      admin.db
        .select({ id: platformInvoices.id, communityId: platformInvoices.communityId })
        .from(platformInvoices)
        .where(eq(platformInvoices.id, records.invoiceId)),
      admin.db
        .select({ id: platformInvoiceLines.id, communityId: platformInvoiceLines.communityId })
        .from(platformInvoiceLines)
        .where(eq(platformInvoiceLines.id, records.lineId)),
    ]);
    expect(kept.map((rows) => rows[0]?.communityId)).toEqual([null, null, null]);
    const subscriptionsLeft = await admin.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, paid.subscriptionId));
    expect(subscriptionsLeft).toEqual([]);
  });

  it("refuses to delete a community whose financial rows were not detached", async () => {
    const paid = await seedPaidCommunity();
    await seedFinancialRecords(paid.communityId, paid.subscriptionId);

    const error = await rejection(deleteCommunityAsTenant(paid.communityId));

    expect(error.code).toBe("23514");
    expect(error.constraint).toMatch(
      /^(payments|fee_ledger_entries|platform_\w+)_community_or_former$/,
    );
    const [community] = await admin.db
      .select({ id: communities.id })
      .from(communities)
      .where(eq(communities.id, paid.communityId));
    expect(community?.id).toBe(paid.communityId);
  });

  it("deletes a community without financial records as before", async () => {
    const paid = await seedPaidCommunity();

    const deleted = await deleteCommunityAsTenant(paid.communityId);

    expect(deleted).toEqual([{ id: paid.communityId }]);
  });

  it("allows only one unfinished exit run per community", async () => {
    const paid = await seedPaidCommunity();
    const other = await seedPaidCommunity();
    const run = (communityId: string, status?: "pending" | "running" | "done" | "failed") =>
      admin.db
        .insert(paymentExitRuns)
        .values({ communityId, kind: "archive", choice: "stop_at_period_end", status })
        .returning();

    const [first] = await run(paid.communityId);
    const second = await rejection(run(paid.communityId, "running"));
    await run(other.communityId);
    await admin.db
      .update(paymentExitRuns)
      .set({ status: "done", finishedAt: new Date() })
      .where(eq(paymentExitRuns.id, first?.id ?? ""));
    const [third] = await run(paid.communityId);

    expect(first).toMatchObject({
      status: "pending",
      attempts: 0,
      targetCount: 0,
      doneCount: 0,
      failedSubscriptionIds: [],
      includeLinked: true,
    });
    expect(second).toEqual(
      expect.objectContaining({ code: "23505", constraint: "payment_exit_runs_one_unfinished" }),
    );
    expect(third?.status).toBe("pending");
  });

  it("backfills accepted_owner_id as a table owner without BYPASSRLS", async () => {
    const paid = await seedPaidCommunity();
    await admin.db
      .update(paymentConnections)
      .set({ acceptedOwnerId: null })
      .where(eq(paymentConnections.id, paid.connectionId));
    const statements = readFileSync(
      new URL("../../migrations/0029_safe_exit_payments.sql", import.meta.url),
      "utf8",
    )
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim());
    const first = statements.indexOf(
      'ALTER TABLE "payment_connections" NO FORCE ROW LEVEL SECURITY;',
    );
    const last = statements.indexOf('ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;');
    const block = statements.slice(first, last + 1);
    const update = block.find((statement) => /^update "payment_connections"/i.test(statement));
    if (first < 0 || last < first || !update) {
      throw new Error("backfill block missing from migration 0029");
    }
    const backfilled = async (statementsToRun: readonly string[]) => {
      const client = await adminPool.connect();
      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock($1)", [migrationLockKey]);
        await lockExclusivelyWithoutWaiting(client, ["payment_connections", "memberships"]);
        await client.query(`alter table payment_connections owner to ${ownerRole}`);
        await client.query(`alter table memberships owner to ${ownerRole}`);
        await client.query(`set local role ${ownerRole}`);
        for (const statement of statementsToRun) {
          await client.query(statement);
        }
        await client.query("reset role");
        const owner = await client.query<{ owner: string | null }>(
          "select accepted_owner_id as owner from payment_connections where id = $1",
          [paid.connectionId],
        );
        const forced = await client.query<{ forced: boolean }>(
          "select relforcerowsecurity as forced from pg_class where relname in ('payment_connections', 'memberships')",
        );
        return {
          owner: owner.rows[0]?.owner ?? null,
          forced: forced.rows.map((row) => row.forced),
        };
      } finally {
        await client.query("rollback");
        client.release();
      }
    };

    const withoutNoForce = await backfilled([update]);
    const migrationBlock = await backfilled(block);

    expect(withoutNoForce.owner).toBeNull();
    expect(migrationBlock).toEqual({ owner: paid.ownerId, forced: [true, true] });
  });

  it("treats a disconnecting connection as still open", async () => {
    const paid = await seedPaidCommunity();
    await admin.db
      .update(paymentConnections)
      .set({ status: "disconnecting" })
      .where(eq(paymentConnections.id, paid.connectionId));

    const error = await rejection(
      admin.db.insert(paymentConnections).values({
        communityId: paid.communityId,
        provider: "stripe_connect",
        status: "onboarding",
      }),
    );

    expect(error.constraint).toBe("payment_connections_one_open_per_community");
  });

  it("lets a member read their own subscriptions in every community without a community setting", async () => {
    const first = await seedPaidCommunity();
    const second = await seedPaidCommunity();
    const customerId = await admin.db
      .insert(paymentCustomers)
      .values({
        communityId: second.communityId,
        userId: first.memberId,
        connectionId: second.connectionId,
        externalCustomerId: `cus_${newId()}`,
      })
      .returning({ id: paymentCustomers.id });
    const [own] = await admin.db
      .insert(subscriptions)
      .values({
        communityId: second.communityId,
        userId: first.memberId,
        customerId: customerId[0]?.id ?? "",
        connectionId: second.connectionId,
        externalSubscriptionId: `sub_${newId()}`,
        providerStatus: "active",
        accessState: "granted",
        applicationFeeBps: 200,
        providerFetchedAt: new Date(),
      })
      .returning();
    const ids = [first.subscriptionId, second.subscriptionId, own?.id ?? ""];

    const visible = await asProbe({ user: first.memberId }, (tx) =>
      tx.select({ id: subscriptions.id }).from(subscriptions).where(inArray(subscriptions.id, ids)),
    );
    const writable = await asProbe({ user: first.memberId }, (tx) =>
      tx
        .update(subscriptions)
        .set({ cancelAtPeriodEnd: true })
        .where(inArray(subscriptions.id, ids))
        .returning({ id: subscriptions.id }),
    );
    const job = await asProbe({ webhook: true }, (tx) =>
      tx.select({ id: subscriptions.id }).from(subscriptions).where(inArray(subscriptions.id, ids)),
    );

    expect(visible.map((row) => row.id).sort()).toEqual(
      [first.subscriptionId, own?.id ?? ""].sort(),
    );
    expect(writable).toEqual([]);
    expect(job).toHaveLength(3);
  });

  it("hides detached rows from a manager of any community", async () => {
    const paid = await seedPaidCommunity("Hidden garden");
    const records = await seedFinancialRecords(paid.communityId, paid.subscriptionId);
    await detachAsAdmin(paid.communityId, "Hidden garden");
    await deleteCommunityAsTenant(paid.communityId);
    const bystander = await seedPaidCommunity();

    const read = (settings: Settings) =>
      asProbe(settings, async (tx) => [
        ...(await tx
          .select({ id: payments.id })
          .from(payments)
          .where(eq(payments.id, records.paymentId))),
        ...(await tx
          .select({ id: feeLedgerEntries.id })
          .from(feeLedgerEntries)
          .where(eq(feeLedgerEntries.id, records.entryId))),
        ...(await tx
          .select({ id: platformBillingAccounts.id })
          .from(platformBillingAccounts)
          .where(eq(platformBillingAccounts.id, records.accountId))),
        ...(await tx
          .select({ id: platformInvoices.id })
          .from(platformInvoices)
          .where(eq(platformInvoices.id, records.invoiceId))),
        ...(await tx
          .select({ id: platformInvoiceLines.id })
          .from(platformInvoiceLines)
          .where(eq(platformInvoiceLines.id, records.lineId))),
      ]);

    expect(await read({ community: bystander.communityId, manager: true })).toEqual([]);
    expect(await read({ community: paid.communityId, manager: true, detach: true })).toEqual([]);
    expect(await read({ manager: true, webhook: true })).toEqual([]);
    expect(await read({ billing: true })).toHaveLength(4);
  });

  it("lets only the detach path write the snapshot on ledger entries", async () => {
    const paid = await seedPaidCommunity();
    const records = await seedFinancialRecords(paid.communityId, paid.subscriptionId);
    const snapshot = (settings: Settings) =>
      asProbe(settings, (tx) =>
        tx
          .update(feeLedgerEntries)
          .set({ formerCommunityId: paid.communityId, formerCommunityName: "Paid garden" })
          .where(eq(feeLedgerEntries.id, records.entryId))
          .returning({ id: feeLedgerEntries.id }),
      );

    const asManager = await snapshot({ community: paid.communityId, manager: true });
    const elsewhere = await snapshot({
      community: (await seedPaidCommunity()).communityId,
      manager: true,
      detach: true,
    });
    const asDetach = await snapshot({ community: paid.communityId, manager: true, detach: true });

    expect(asManager).toEqual([]);
    expect(elsewhere).toEqual([]);
    expect(asDetach).toEqual([{ id: records.entryId }]);
  });

  it("rejects amount and rate changes under the detach setting and keeps normal payment updates", async () => {
    const paid = await seedPaidCommunity();
    const records = await seedFinancialRecords(paid.communityId, paid.subscriptionId);
    const detach = { community: paid.communityId, manager: true, detach: true };

    const amount = await rejection(
      asProbe(detach, (tx) =>
        tx
          .update(payments)
          .set({ amountMinor: 1, formerCommunityId: paid.communityId, formerCommunityName: "x" })
          .where(eq(payments.id, records.paymentId)),
      ),
    );
    const rate = await rejection(
      asProbe(detach, (tx) =>
        tx
          .update(feeLedgerEntries)
          .set({ rateBps: 1 })
          .where(eq(feeLedgerEntries.id, records.entryId)),
      ),
    );
    const ledgerAsOwner = await rejection(
      admin.db
        .update(feeLedgerEntries)
        .set({ computedFeeMinor: 1 })
        .where(eq(feeLedgerEntries.id, records.entryId)),
    );
    const refund = await asProbe({ community: paid.communityId, manager: true }, (tx) =>
      tx
        .update(payments)
        .set({ refundedMinor: 900 })
        .where(eq(payments.id, records.paymentId))
        .returning({ refundedMinor: payments.refundedMinor }),
    );

    expect([amount.code, rate.code, ledgerAsOwner.code]).toEqual(["23514", "23514", "23514"]);
    expect(refund).toEqual([{ refundedMinor: 900 }]);
  });

  it("keeps the snapshot fixed once written and matching the community", async () => {
    const paid = await seedPaidCommunity("Fixed garden");
    const other = await seedPaidCommunity();
    const records = await seedFinancialRecords(paid.communityId, paid.subscriptionId);

    const mismatch = await rejection(
      admin.db
        .update(payments)
        .set({ formerCommunityId: other.communityId, formerCommunityName: "Fixed garden" })
        .where(eq(payments.id, records.paymentId)),
    );
    await detachAsAdmin(paid.communityId, "Fixed garden");
    const rename = await rejection(
      admin.db
        .update(payments)
        .set({ formerCommunityName: "Renamed" })
        .where(eq(payments.id, records.paymentId)),
    );
    await deleteCommunityAsTenant(paid.communityId);
    const afterDelete = await rejection(
      admin.db
        .update(platformInvoices)
        .set({ amountMinor: 1 })
        .where(eq(platformInvoices.id, records.invoiceId)),
    );

    expect(mismatch).toMatchObject({ code: "23514", constraint: "payments_former_matches" });
    expect(rename.code).toBe("23514");
    expect(afterDelete.code).toBe("23514");
  });

  it("keeps exit runs to the community's managers and the exit job", async () => {
    const paid = await seedPaidCommunity();
    const other = await seedPaidCommunity();
    const values = { kind: "delete" as const, choice: "cancel_now" as const };

    const byMember = await rejection(
      asProbe({ community: paid.communityId }, (tx) =>
        tx.insert(paymentExitRuns).values({ ...values, communityId: paid.communityId }),
      ),
    );
    const [created] = await asProbe({ community: paid.communityId, manager: true }, (tx) =>
      tx
        .insert(paymentExitRuns)
        .values({ ...values, communityId: paid.communityId, connectionId: paid.connectionId })
        .returning(),
    );
    const memberRead = await asProbe({ community: paid.communityId }, (tx) =>
      tx.select({ id: paymentExitRuns.id }).from(paymentExitRuns),
    );
    const otherRead = await asProbe({ community: other.communityId, manager: true }, (tx) =>
      tx.select({ id: paymentExitRuns.id }).from(paymentExitRuns),
    );
    const jobUpdate = await asProbe({ webhook: true }, (tx) =>
      tx
        .update(paymentExitRuns)
        .set({ status: "running", attempts: 1 })
        .where(eq(paymentExitRuns.id, created?.id ?? ""))
        .returning({ status: paymentExitRuns.status }),
    );

    const managerRead = await asProbe({ community: paid.communityId, manager: true }, (tx) =>
      tx.select({ id: paymentExitRuns.id }).from(paymentExitRuns),
    );

    expect(byMember.code).toBe("42501");
    expect(memberRead).toEqual([]);
    expect(managerRead).toEqual([{ id: created?.id }]);
    expect(otherRead).toEqual([]);
    expect(jobUpdate).toEqual([{ status: "running" }]);
  });

  it("accepts community notices about paid memberships without a post", async () => {
    const paid = await seedPaidCommunity();

    const [row] = await admin.db
      .insert(notifications)
      .values({
        communityId: paid.communityId,
        userId: paid.memberId,
        actorId: paid.ownerId,
        type: "paid_membership_changed",
        subjectType: "community",
        subjectId: paid.communityId,
      })
      .returning({ type: notifications.type });

    expect(row?.type).toBe("paid_membership_changed");
  });
});
