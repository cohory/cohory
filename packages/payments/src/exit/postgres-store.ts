import { appendOutbox, newId, withRlsFlags, type RlsFlag, type ScopedQueries } from "@cohory/db";
import {
  feeLedgerEntries,
  paymentExitRuns,
  paymentConnections,
  payments,
  platformBillingAccounts,
  platformInvoiceLines,
  platformInvoices,
  subscriptions,
  users,
  type PaymentProvider,
} from "@cohory/db/schema";
import { asc, count, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { ExitInProgressError } from "../errors";
import { paidMembershipEventsTopic } from "./events";
import type { SubscriptionOrigin } from "../tenure/store";
import {
  exitEligibleStatuses,
  type DetachResult,
  type ExitStore,
  type FinancialSnapshot,
} from "./store";

const unfinished = ["pending", "running"] as const;
const unpaidInvoiceStatuses = ["draft", "open"] as const;
const billedKinds = ["fee_accrued", "fee_refunded", "adjustment"] as const;
const grantingStates = ["granted", "grace"] as const;
export const feeWriteOffReason = "community_deleted_below_minimum";
export const noticeEventsPerOutboxRow = 20;
const detachedTables = [
  payments,
  feeLedgerEntries,
  platformBillingAccounts,
  platformInvoices,
  platformInvoiceLines,
] as const;

function originOf(value: string): SubscriptionOrigin {
  return value === "linked_import" ? "linked_import" : "created_by_cohory";
}

export function createExitStore({ tx, where, values, communityId }: ScopedQueries): ExitStore {
  async function first<T>(rows: Promise<T[]>): Promise<T | null> {
    return (await rows)[0] ?? null;
  }

  function eligible(connectionId: string | null) {
    return where(
      subscriptions,
      inArray(subscriptions.providerStatus, [...exitEligibleStatuses]),
      connectionId === null ? undefined : eq(subscriptions.connectionId, connectionId),
    );
  }

  function withSettings<T>(flags: readonly RlsFlag[], fn: () => Promise<T>): Promise<T> {
    return withRlsFlags(tx, flags, fn);
  }

  async function detachedCount(
    table: typeof payments | typeof feeLedgerEntries | typeof platformInvoices,
  ): Promise<number> {
    const [row] = await tx
      .select({ value: count() })
      .from(table)
      .where(where(table, isNotNull(table.formerCommunityId)));
    return row?.value ?? 0;
  }

  return {
    async insertRun(input) {
      const row = await first(
        tx
          .insert(paymentExitRuns)
          .values(values(input))
          .onConflictDoNothing({
            target: paymentExitRuns.communityId,
            where: sql`${paymentExitRuns.status} in ('pending', 'running')`,
          })
          .returning(),
      );
      if (!row) {
        throw new ExitInProgressError();
      }
      return row;
    },

    findRun(runId) {
      return first(
        tx
          .select()
          .from(paymentExitRuns)
          .where(where(paymentExitRuns, eq(paymentExitRuns.id, runId)))
          .limit(1),
      );
    },

    findUnfinishedRun() {
      return first(
        tx
          .select()
          .from(paymentExitRuns)
          .where(where(paymentExitRuns, inArray(paymentExitRuns.status, [...unfinished])))
          .limit(1),
      );
    },

    latestRun(kind) {
      return first(
        tx
          .select()
          .from(paymentExitRuns)
          .where(where(paymentExitRuns, eq(paymentExitRuns.kind, kind)))
          .orderBy(desc(paymentExitRuns.createdAt), desc(paymentExitRuns.id))
          .limit(1),
      );
    },

    async updateRun(runId, patch) {
      const row = await first(
        tx
          .update(paymentExitRuns)
          .set({ ...patch, updatedAt: new Date() })
          .where(where(paymentExitRuns, eq(paymentExitRuns.id, runId)))
          .returning(),
      );
      if (!row) {
        throw new Error("exit run update returned no row");
      }
      return row;
    },

    async listExitSubscriptions(connectionId) {
      const rows = await tx
        .select({
          id: subscriptions.id,
          userId: subscriptions.userId,
          connectionId: subscriptions.connectionId,
          externalSubscriptionId: subscriptions.externalSubscriptionId,
          origin: subscriptions.origin,
          providerStatus: subscriptions.providerStatus,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
          cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
          applicationFeeBps: subscriptions.applicationFeeBps,
        })
        .from(subscriptions)
        .where(eligible(connectionId))
        .orderBy(asc(subscriptions.createdAt), asc(subscriptions.id));
      return rows.map((row) => ({ ...row, origin: originOf(row.origin) }));
    },

    async countExitSubscriptions(connectionId) {
      const rows = await tx
        .select({ origin: subscriptions.origin, value: count() })
        .from(subscriptions)
        .where(eligible(connectionId))
        .groupBy(subscriptions.origin);
      const linkedImports = rows
        .filter((row) => originOf(row.origin) === "linked_import")
        .reduce((sum, row) => sum + row.value, 0);
      const total = rows.reduce((sum, row) => sum + row.value, 0);
      return { cohory: total - linkedImports, linkedImports };
    },

    async appendNotices(events, scope) {
      for (let start = 0; start < events.length; start += noticeEventsPerOutboxRow) {
        await appendOutbox(tx, {
          id: newId(),
          communityId: scope === "community" ? communityId : null,
          topic: paidMembershipEventsTopic,
          payload: { events: events.slice(start, start + noticeEventsPerOutboxRow) },
        });
      }
    },

    async setCancelAtPeriodEnd(subscriptionId, cancelAtPeriodEnd) {
      await tx
        .update(subscriptions)
        .set({ cancelAtPeriodEnd, updatedAt: new Date() })
        .where(where(subscriptions, eq(subscriptions.id, subscriptionId)));
    },

    async listSubscriptionMembers(subscriptionIds) {
      if (subscriptionIds.length === 0) {
        return [];
      }
      return tx
        .select({
          subscriptionId: subscriptions.id,
          userId: subscriptions.userId,
          name: users.name,
        })
        .from(subscriptions)
        .innerJoin(users, eq(users.id, subscriptions.userId))
        .where(where(subscriptions, inArray(subscriptions.id, [...subscriptionIds])))
        .orderBy(asc(users.name), asc(subscriptions.id));
    },

    async hasClosedConnection() {
      const row = await first(
        tx
          .select({ id: paymentConnections.id })
          .from(paymentConnections)
          .where(where(paymentConnections, eq(paymentConnections.status, "disconnected")))
          .limit(1),
      );
      return row !== null;
    },

    async billingBlockers() {
      return withSettings(["payments_manager"], async () => {
        const [invoices] = await tx
          .select({ value: count() })
          .from(platformInvoices)
          .where(
            where(platformInvoices, inArray(platformInvoices.status, [...unpaidInvoiceStatuses])),
          );
        const balances = await tx
          .select({
            currency: feeLedgerEntries.currency,
            provider: sql<PaymentProvider>`min(${feeLedgerEntries.provider}::text)`,
            balance: sql<string>`coalesce(sum(${feeLedgerEntries.computedFeeMinor}), 0)`,
          })
          .from(feeLedgerEntries)
          .where(
            where(
              feeLedgerEntries,
              eq(feeLedgerEntries.collectionMethod, "periodic_invoice"),
              inArray(feeLedgerEntries.kind, [...billedKinds]),
              sql`not exists (select 1 from ${platformInvoiceLines} where ${platformInvoiceLines.ledgerEntryId} = ${feeLedgerEntries.id})`,
            ),
          )
          .groupBy(feeLedgerEntries.currency)
          .orderBy(feeLedgerEntries.currency);
        return {
          unpaidInvoices: invoices?.value ?? 0,
          openBalances: balances
            .map((row) => ({
              currency: row.currency,
              provider: row.provider,
              balanceMinor: Number(row.balance),
            }))
            .filter((row) => row.balanceMinor > 0),
        };
      });
    },

    async writeOffFeeBalance(input) {
      return withSettings(["payments_manager"], async () => {
        const inserted = await tx
          .insert(feeLedgerEntries)
          .values(
            values({
              kind: "adjustment" as const,
              provider: input.provider,
              collectionMethod: "periodic_invoice" as const,
              currency: input.currency,
              baseMinor: 0,
              rateBps: 0,
              computedFeeMinor: -input.amountMinor,
              externalRef: feeWriteOffReason,
              idempotencyKey: `fee:written_off:${communityId}:${input.currency}`,
              occurredAt: input.occurredAt,
            }),
          )
          .onConflictDoNothing()
          .returning({ id: feeLedgerEntries.id });
        return inserted.length > 0;
      });
    },

    async listDeferredRemovals(since) {
      const rows = await tx
        .selectDistinct({ userId: subscriptions.userId })
        .from(subscriptions)
        .where(
          where(
            subscriptions,
            gte(subscriptions.updatedAt, since),
            sql`${subscriptions.accessState} not in ('granted', 'grace')`,
            sql`not exists (select 1 from ${subscriptions} as granting where granting.community_id = ${subscriptions.communityId} and granting.user_id = ${subscriptions.userId} and granting.access_state in (${sql.join(
              grantingStates.map((state) => sql`${state}`),
              sql`, `,
            )}))`,
          ),
        )
        .orderBy(subscriptions.userId);
      return rows.map((row) => row.userId);
    },

    detachFinancialRecords(snapshot: FinancialSnapshot): Promise<DetachResult> {
      if (snapshot.communityId !== communityId) {
        throw new Error("snapshot community does not match the store");
      }
      return withSettings(["payments_detach", "payments_manager"], async () => {
        for (const table of detachedTables) {
          await tx
            .update(table)
            .set({
              formerCommunityId: snapshot.communityId,
              formerCommunityName: snapshot.communityName,
            })
            .where(where(table, isNull(table.formerCommunityId)));
        }
        return {
          payments: await detachedCount(payments),
          ledgerEntries: await detachedCount(feeLedgerEntries),
          invoices: await detachedCount(platformInvoices),
        };
      });
    },
  };
}
