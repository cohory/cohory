import {
  communityIdSchema,
  getCommunityById,
  runInCommunity,
  setRlsFlag,
  withCommunity,
  type Database,
  type ScopedQueries,
  type Transaction,
} from "@cohory/db";
import {
  feeLedgerEntries,
  memberships,
  platformBillingAccounts,
  platformBillingIssues,
  platformInvoiceLines,
  platformInvoices,
  users,
} from "@cohory/db/schema";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, notInArray, sql } from "drizzle-orm";

import type { BillingRepository, BillingStore, CommunityScope, CurrencyBalance } from "./store";

const billedKinds = ["fee_accrued", "fee_refunded", "adjustment"] as const;

async function first<T>(rows: Promise<T[]>): Promise<T | null> {
  return (await rows)[0] ?? null;
}

async function required<T>(rows: Promise<T[]>): Promise<T> {
  const row = (await rows)[0];
  if (!row) {
    throw new Error("write returned no row");
  }
  return row;
}

const unbilled = sql`not exists (select 1 from ${platformInvoiceLines} where ${platformInvoiceLines.ledgerEntryId} = ${feeLedgerEntries.id})`;

function periodicEntry() {
  return and(
    eq(feeLedgerEntries.collectionMethod, "periodic_invoice"),
    inArray(feeLedgerEntries.kind, [...billedKinds]),
  );
}

function scoped(
  column: typeof platformInvoices.communityId | typeof feeLedgerEntries.communityId,
  scope: CommunityScope,
) {
  return scope ? inArray(column, [...scope]) : isNotNull(column);
}

function createStore(queries: ScopedQueries): BillingStore {
  const { tx, where, values, communityId } = queries;

  function own<T extends { communityId: string | null }>(row: T): T & { communityId: string } {
    return { ...row, communityId };
  }

  async function firstOwn<T extends { communityId: string | null }>(rows: Promise<T[]>) {
    const row = await first(rows);
    return row ? own(row) : null;
  }

  async function requiredOwn<T extends { communityId: string | null }>(rows: Promise<T[]>) {
    return own(await required(rows));
  }

  async function allOwn<T extends { communityId: string | null }>(rows: Promise<T[]>) {
    return (await rows).map(own);
  }

  async function findAccount() {
    return firstOwn(
      tx.select().from(platformBillingAccounts).where(where(platformBillingAccounts)),
    );
  }

  return {
    communityId,
    findAccount,

    async ensureAccount() {
      await tx.insert(platformBillingAccounts).values(values({})).onConflictDoNothing();
      const account = await findAccount();
      if (!account) {
        throw new Error("billing account insert returned no row");
      }
      return account;
    },

    updateAccount(patch) {
      return requiredOwn(
        tx
          .update(platformBillingAccounts)
          .set({ ...patch, updatedAt: new Date() })
          .where(where(platformBillingAccounts))
          .returning(),
      );
    },

    async findOwnerEmail() {
      const row = await first(
        tx
          .select({ email: users.email })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(where(memberships, eq(memberships.role, "owner")))
          .limit(1),
      );
      return row?.email ?? null;
    },

    async createInvoice(input) {
      const existing = await firstOwn(
        tx
          .select()
          .from(platformInvoices)
          .where(
            where(
              platformInvoices,
              eq(platformInvoices.currency, input.currency),
              eq(platformInvoices.periodStart, input.periodStart),
            ),
          ),
      );
      if (existing) {
        return { kind: "exists", invoice: existing };
      }
      const entries = await tx
        .select({ id: feeLedgerEntries.id, amount: feeLedgerEntries.computedFeeMinor })
        .from(feeLedgerEntries)
        .where(
          and(
            eq(feeLedgerEntries.communityId, communityId),
            eq(feeLedgerEntries.currency, input.currency),
            lt(feeLedgerEntries.occurredAt, input.periodEnd),
            periodicEntry(),
            unbilled,
          ),
        );
      const balanceMinor = entries.reduce((sum, entry) => sum + entry.amount, 0);
      if (balanceMinor < input.minimumMinor) {
        return { kind: "below_minimum", balanceMinor };
      }
      const invoice = await requiredOwn(
        tx
          .insert(platformInvoices)
          .values(
            values({
              billingAccountId: input.billingAccountId,
              currency: input.currency,
              periodStart: input.periodStart,
              periodEnd: input.periodEnd,
              amountMinor: balanceMinor,
              collectionMethod: input.collectionMethod,
            }),
          )
          .returning(),
      );
      await tx
        .insert(platformInvoiceLines)
        .values(
          entries.map((entry) =>
            values({ invoiceId: invoice.id, ledgerEntryId: entry.id, amountMinor: entry.amount }),
          ),
        );
      return { kind: "created", invoice };
    },

    findInvoice(invoiceId) {
      return firstOwn(
        tx
          .select()
          .from(platformInvoices)
          .where(where(platformInvoices, eq(platformInvoices.id, invoiceId))),
      );
    },

    findInvoiceByStripe(stripeInvoiceId) {
      return firstOwn(
        tx
          .select()
          .from(platformInvoices)
          .where(where(platformInvoices, eq(platformInvoices.stripeInvoiceId, stripeInvoiceId))),
      );
    },

    updateInvoice(invoiceId, patch) {
      return requiredOwn(
        tx
          .update(platformInvoices)
          .set({ ...patch, updatedAt: new Date() })
          .where(where(platformInvoices, eq(platformInvoices.id, invoiceId)))
          .returning(),
      );
    },

    listInvoices(limit) {
      return allOwn(
        tx
          .select()
          .from(platformInvoices)
          .where(where(platformInvoices))
          .orderBy(desc(platformInvoices.periodStart), platformInvoices.currency)
          .limit(limit),
      );
    },

    async invoiceTotals(invoiceId) {
      const row = await first(
        tx
          .select({
            lines: sql<string>`coalesce(sum(${platformInvoiceLines.amountMinor}), 0)`,
            ledger: sql<string>`coalesce(sum(${feeLedgerEntries.computedFeeMinor}), 0)`,
          })
          .from(platformInvoiceLines)
          .innerJoin(feeLedgerEntries, eq(feeLedgerEntries.id, platformInvoiceLines.ledgerEntryId))
          .where(where(platformInvoiceLines, eq(platformInvoiceLines.invoiceId, invoiceId))),
      );
      return { linesMinor: Number(row?.lines ?? 0), ledgerMinor: Number(row?.ledger ?? 0) };
    },

    async ledgerAccruedBase(currency, periodStart, periodEnd) {
      const row = await first(
        tx
          .select({ base: sql<string>`coalesce(sum(${feeLedgerEntries.baseMinor}), 0)` })
          .from(feeLedgerEntries)
          .where(
            and(
              eq(feeLedgerEntries.communityId, communityId),
              eq(feeLedgerEntries.currency, currency),
              eq(feeLedgerEntries.kind, "fee_accrued"),
              eq(feeLedgerEntries.collectionMethod, "periodic_invoice"),
              gte(feeLedgerEntries.occurredAt, periodStart),
              lt(feeLedgerEntries.occurredAt, periodEnd),
            ),
          ),
      );
      return Number(row?.base ?? 0);
    },

    async balances(currentPeriodStart) {
      const rows = await tx
        .select({
          currency: feeLedgerEntries.currency,
          current: sql<string>`coalesce(sum(${feeLedgerEntries.computedFeeMinor}) filter (where ${feeLedgerEntries.occurredAt} >= ${currentPeriodStart}), 0)`,
          carried: sql<string>`coalesce(sum(${feeLedgerEntries.computedFeeMinor}) filter (where ${feeLedgerEntries.occurredAt} < ${currentPeriodStart}), 0)`,
        })
        .from(feeLedgerEntries)
        .where(and(eq(feeLedgerEntries.communityId, communityId), periodicEntry(), unbilled))
        .groupBy(feeLedgerEntries.currency)
        .orderBy(feeLedgerEntries.currency);
      return rows.map((row): CurrencyBalance => ({
        currency: row.currency,
        currentMinor: Number(row.current),
        carriedMinor: Number(row.carried),
      }));
    },

    async hasPeriodicEntries() {
      const row = await first(
        tx
          .select({ id: feeLedgerEntries.id })
          .from(feeLedgerEntries)
          .where(and(eq(feeLedgerEntries.communityId, communityId), periodicEntry()))
          .limit(1),
      );
      return row !== null;
    },

    async recordIssue(input) {
      const inserted = await tx
        .insert(platformBillingIssues)
        .values(values({ ...input }))
        .onConflictDoNothing()
        .returning({ id: platformBillingIssues.id });
      return inserted.length > 0;
    },

    async resolveIssues(currency, periodStart, keep, at) {
      await tx
        .update(platformBillingIssues)
        .set({ resolvedAt: at, updatedAt: at })
        .where(
          where(
            platformBillingIssues,
            eq(platformBillingIssues.currency, currency),
            eq(platformBillingIssues.periodStart, periodStart),
            isNull(platformBillingIssues.resolvedAt),
            keep.length > 0 ? notInArray(platformBillingIssues.kind, [...keep]) : undefined,
          ),
        );
    },

    listOpenIssues() {
      return tx
        .select({
          id: platformBillingIssues.id,
          invoiceId: platformBillingIssues.invoiceId,
          kind: platformBillingIssues.kind,
          currency: platformBillingIssues.currency,
          periodStart: platformBillingIssues.periodStart,
          expectedMinor: platformBillingIssues.expectedMinor,
          actualMinor: platformBillingIssues.actualMinor,
          detectedAt: platformBillingIssues.detectedAt,
        })
        .from(platformBillingIssues)
        .where(where(platformBillingIssues, isNull(platformBillingIssues.resolvedAt)))
        .orderBy(desc(platformBillingIssues.detectedAt))
        .limit(50);
    },

    pastDueInvoices() {
      return allOwn(
        tx
          .select()
          .from(platformInvoices)
          .where(
            where(
              platformInvoices,
              eq(platformInvoices.status, "open"),
              sql`${platformInvoices.pastDueSince} is not null`,
            ),
          ),
      );
    },
  };
}

export function createPostgresBillingRepository(db: Database): BillingRepository {
  function global<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await setRlsFlag(tx, "platform_billing");
      return fn(tx);
    });
  }

  return {
    asBilling(communityId, fn) {
      return runInCommunity(withCommunity(db, communityId), async (queries) => {
        await setRlsFlag(queries.tx, "platform_billing");
        return fn(createStore(queries));
      });
    },

    asManager(communityId, fn) {
      return runInCommunity(withCommunity(db, communityId), async (queries) => {
        await setRlsFlag(queries.tx, "payments_manager");
        return fn(createStore(queries));
      });
    },

    listBillableBalances(periodEnd, scope) {
      return global(async (tx) => {
        const rows = await tx
          .select({
            communityId: feeLedgerEntries.communityId,
            currency: feeLedgerEntries.currency,
            balance: sql<string>`sum(${feeLedgerEntries.computedFeeMinor})`,
            entries: sql<number>`count(*)::int`,
          })
          .from(feeLedgerEntries)
          .where(
            and(
              lt(feeLedgerEntries.occurredAt, periodEnd),
              periodicEntry(),
              unbilled,
              scoped(feeLedgerEntries.communityId, scope),
            ),
          )
          .groupBy(feeLedgerEntries.communityId, feeLedgerEntries.currency)
          .orderBy(feeLedgerEntries.communityId, feeLedgerEntries.currency);
        return rows.map((row) => ({
          communityId: communityIdSchema.parse(row.communityId),
          currency: row.currency,
          balanceMinor: Number(row.balance),
          entryCount: row.entries,
        }));
      });
    },

    listUnsettledInvoices(scope) {
      return global(async (tx) => {
        const rows = await tx
          .select({ communityId: platformInvoices.communityId, invoiceId: platformInvoices.id })
          .from(platformInvoices)
          .where(
            and(
              inArray(platformInvoices.status, ["draft", "open"]),
              scoped(platformInvoices.communityId, scope),
            ),
          )
          .orderBy(platformInvoices.createdAt);
        return rows.map((row) => ({
          ...row,
          communityId: communityIdSchema.parse(row.communityId),
        }));
      });
    },

    listInvoicesSince(periodStart, scope) {
      return global(async (tx) => {
        const rows = await tx
          .select({ communityId: platformInvoices.communityId, invoiceId: platformInvoices.id })
          .from(platformInvoices)
          .where(
            and(
              gte(platformInvoices.periodStart, periodStart),
              scoped(platformInvoices.communityId, scope),
            ),
          )
          .orderBy(platformInvoices.createdAt);
        return rows.map((row) => ({
          ...row,
          communityId: communityIdSchema.parse(row.communityId),
        }));
      });
    },

    listCommunitiesWithAccounts() {
      return global(async (tx) => {
        const rows = await tx
          .select({ communityId: platformBillingAccounts.communityId })
          .from(platformBillingAccounts)
          .where(isNotNull(platformBillingAccounts.communityId));
        return rows.map((row) => communityIdSchema.parse(row.communityId));
      });
    },

    async findCommunity(communityId) {
      const community = await getCommunityById(db, communityId);
      return community
        ? { name: community.name, slug: community.slug, appearance: community.appearance }
        : null;
    },
  };
}
