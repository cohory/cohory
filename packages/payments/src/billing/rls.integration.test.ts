import { newId, type Database } from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import {
  feeLedgerEntries,
  platformBillingAccounts,
  platformBillingIssues,
  platformInvoices,
} from "@cohory/db/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { insertCommunity, openProbeDb, openTestDb, probeRole } from "../test/fixtures";
import { insertAccrual } from "./testing/harness";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface Settings {
  community?: string;
  manager?: boolean;
  billing?: boolean;
}

function asProbe<T>(settings: Settings, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return probe.db.transaction(async (tx) => {
    const set = async (name: string, value: string | undefined) => {
      if (value) await tx.execute(sql`select set_config(${name}, ${value}, true)`);
    };
    await set("app.community_id", settings.community);
    await set("app.payments_manager", settings.manager ? "on" : undefined);
    await set("app.platform_billing", settings.billing ? "on" : undefined);
    return fn(tx);
  });
}

async function seed() {
  const communityId = await insertCommunity(admin.db);
  const [account] = await admin.db
    .insert(platformBillingAccounts)
    .values({ communityId, billingEmail: `owner-${newId()}@example.test` })
    .returning();
  await admin.db.insert(platformInvoices).values({
    communityId,
    billingAccountId: account?.id ?? "",
    currency: "usd",
    periodStart: new Date("2020-01-01T00:00:00.000Z"),
    periodEnd: new Date("2020-02-01T00:00:00.000Z"),
    amountMinor: 700,
    status: "paid",
    collectionMethod: "send_invoice",
  });
  await insertAccrual(admin.db, communityId, {
    feeMinor: 100,
    occurredAt: new Date("2020-01-05T00:00:00.000Z"),
  });
  return { communityId, accountId: account?.id ?? "" };
}

let a: Awaited<ReturnType<typeof seed>>;
let b: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
  await admin.db.transaction(async (tx) => {
    await tx.execute(sql.raw(`select pg_advisory_xact_lock(${migrationLockKey})`));
    await tx.execute(
      sql.raw(
        `grant select, insert, update, delete on platform_billing_accounts, platform_invoices, platform_invoice_lines, platform_billing_issues to ${probeRole}`,
      ),
    );
  });
  a = await seed();
  b = await seed();
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

describe("platform billing row level security", () => {
  it("hides billing rows without a community and a role setting", async () => {
    expect(await asProbe({}, (tx) => tx.select().from(platformInvoices))).toEqual([]);
    expect(
      await asProbe({ community: a.communityId }, (tx) =>
        tx.select().from(platformBillingAccounts),
      ),
    ).toEqual([]);
  });

  it("lets payment managers read only their own community", async () => {
    const rows = await asProbe({ community: a.communityId, manager: true }, (tx) =>
      tx.select().from(platformInvoices),
    );
    expect(rows.map((row) => row.communityId)).toEqual([a.communityId]);
  });

  it("lets payment managers change their billing account but not invoices", async () => {
    const updated = await asProbe({ community: a.communityId, manager: true }, (tx) =>
      tx
        .update(platformBillingAccounts)
        .set({ billingEmail: "new@example.test" })
        .where(eq(platformBillingAccounts.id, b.accountId))
        .returning(),
    );
    expect(updated).toEqual([]);
    await expect(
      asProbe({ community: a.communityId, manager: true }, (tx) =>
        tx.insert(platformBillingIssues).values({
          communityId: a.communityId,
          kind: "ledger_amount_mismatch",
          currency: "usd",
          periodStart: new Date("2020-01-01T00:00:00.000Z"),
          detectedAt: new Date(),
        }),
      ),
    ).rejects.toThrow();
  });

  it("lets the billing job read across communities but write only inside the scoped one", async () => {
    const invoices = await asProbe({ billing: true }, (tx) => tx.select().from(platformInvoices));
    const ids = new Set(invoices.map((row) => row.communityId));
    expect(ids.has(a.communityId) && ids.has(b.communityId)).toBe(true);
    const ledger = await asProbe({ billing: true }, (tx) =>
      tx.select({ communityId: feeLedgerEntries.communityId }).from(feeLedgerEntries),
    );
    expect(ledger.some((row) => row.communityId === b.communityId)).toBe(true);

    const crossTenant = await asProbe({ community: a.communityId, billing: true }, (tx) =>
      tx
        .update(platformInvoices)
        .set({ status: "void" })
        .where(eq(platformInvoices.communityId, b.communityId))
        .returning(),
    );
    expect(crossTenant).toEqual([]);
  });
});
