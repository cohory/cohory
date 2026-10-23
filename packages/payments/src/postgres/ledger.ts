import { type ScopedQueries } from "@cohory/db";
import { feeLedgerEntries, payments } from "@cohory/db/schema";
import { and, eq, sql } from "drizzle-orm";

import type { PaymentsStore } from "../repository";
import { first, required } from "./rows";

export function createLedgerStore(
  queries: ScopedQueries,
): Pick<
  PaymentsStore,
  | "upsertPayment"
  | "findPaymentByIntent"
  | "setPaymentRefunded"
  | "lockPaymentByIntent"
  | "setPaymentDispute"
  | "insertLedgerEntry"
  | "accruedFeeTotals"
  | "currencyTotals"
> {
  const { tx, where, values, communityId } = queries;

  return {
    upsertPayment(input) {
      return required(
        tx
          .insert(payments)
          .values(values(input))
          .onConflictDoUpdate({
            target: payments.externalInvoiceId,
            set: {
              externalPaymentIntentId: sql`coalesce(excluded.external_payment_intent_id, ${payments.externalPaymentIntentId})`,
              subscriptionId: sql`coalesce(excluded.subscription_id, ${payments.subscriptionId})`,
              updatedAt: new Date(),
            },
            setWhere: eq(payments.communityId, communityId),
          })
          .returning(),
      );
    },

    findPaymentByIntent(paymentIntentId) {
      return first(
        tx
          .select()
          .from(payments)
          .where(where(payments, eq(payments.externalPaymentIntentId, paymentIntentId)))
          .limit(1),
      );
    },

    async setPaymentRefunded(paymentId, refundedMinor) {
      await tx
        .update(payments)
        .set({ refundedMinor, updatedAt: new Date() })
        .where(where(payments, eq(payments.id, paymentId)));
    },

    lockPaymentByIntent(paymentIntentId) {
      return first(
        tx
          .select()
          .from(payments)
          .where(where(payments, eq(payments.externalPaymentIntentId, paymentIntentId)))
          .for("update")
          .limit(1),
      );
    },

    async setPaymentDispute(paymentId, dispute) {
      await tx
        .update(payments)
        .set({ ...dispute, updatedAt: new Date() })
        .where(where(payments, eq(payments.id, paymentId)));
    },

    async insertLedgerEntry(input) {
      const inserted = await tx
        .insert(feeLedgerEntries)
        .values(values(input))
        .onConflictDoNothing({ target: feeLedgerEntries.idempotencyKey })
        .returning({ id: feeLedgerEntries.id });
      return inserted.length > 0;
    },

    async accruedFeeTotals(paymentId) {
      const [row] = await tx
        .select({
          accruedMinor:
            sql<number>`coalesce(sum(${feeLedgerEntries.computedFeeMinor}) filter (where ${feeLedgerEntries.kind} = 'fee_accrued'), 0)`.mapWith(
              Number,
            ),
          refundedMinor:
            sql<number>`coalesce(-sum(${feeLedgerEntries.computedFeeMinor}) filter (where ${feeLedgerEntries.kind} = 'fee_refunded'), 0)`.mapWith(
              Number,
            ),
        })
        .from(feeLedgerEntries)
        .where(
          where(
            feeLedgerEntries,
            and(
              eq(feeLedgerEntries.paymentId, paymentId),
              eq(feeLedgerEntries.collectionMethod, "periodic_invoice"),
            ),
          ),
        );
      return { accruedMinor: row?.accruedMinor ?? 0, refundedMinor: row?.refundedMinor ?? 0 };
    },

    async currencyTotals() {
      const gross = await tx
        .select({
          currency: payments.currency,
          paymentCount: sql<number>`count(*)`.mapWith(Number),
          grossMinor: sql<number>`coalesce(sum(${payments.amountMinor}), 0)`.mapWith(Number),
          refundedMinor: sql<number>`coalesce(sum(${payments.refundedMinor}), 0)`.mapWith(Number),
          taxMinor: sql<number>`coalesce(sum(${payments.taxMinor}), 0)`.mapWith(Number),
        })
        .from(payments)
        .where(where(payments))
        .groupBy(payments.currency);
      const fees = await tx
        .select({
          currency: feeLedgerEntries.currency,
          collected:
            sql<number>`coalesce(sum(coalesce(${feeLedgerEntries.providerFeeMinor}, ${feeLedgerEntries.computedFeeMinor})) filter (where ${feeLedgerEntries.kind} in ('fee_collected', 'fee_accrued')), 0)`.mapWith(
              Number,
            ),
          refunded:
            sql<number>`coalesce(-sum(coalesce(${feeLedgerEntries.providerFeeMinor}, ${feeLedgerEntries.computedFeeMinor})) filter (where ${feeLedgerEntries.kind} = 'fee_refunded'), 0)`.mapWith(
              Number,
            ),
        })
        .from(feeLedgerEntries)
        .where(where(feeLedgerEntries))
        .groupBy(feeLedgerEntries.currency);
      const currencies = new Set([...gross.map((g) => g.currency), ...fees.map((f) => f.currency)]);
      return [...currencies].sort().map((currency) => {
        const g = gross.find((row) => row.currency === currency);
        const f = fees.find((row) => row.currency === currency);
        return {
          currency,
          paymentCount: g?.paymentCount ?? 0,
          grossMinor: g?.grossMinor ?? 0,
          refundedMinor: g?.refundedMinor ?? 0,
          taxMinor: g?.taxMinor ?? 0,
          platformFeeMinor: f?.collected ?? 0,
          platformFeeRefundedMinor: f?.refunded ?? 0,
        };
      });
    },
  };
}
