import type { PlatformBillingIssueKind } from "@cohory/db/schema";
import type { CommunityId } from "@cohory/db";

import type { Invoicing } from "./invoicing";
import { periodContaining } from "./period";
import { billingEnabled, callBillingStripe, requireGateway, type BillingRuntime } from "./runtime";
import type { IssueInput, PlatformInvoiceRecord } from "./store";

export const reconcileLookbackMonths = 3;
export const missingInvoiceGraceMs = 24 * 60 * 60_000;

export interface ReconcileResult {
  readonly synced: number;
  readonly checked: number;
  readonly issues: number;
  readonly failed: number;
}

function lookbackStart(now: Date): Date {
  const current = periodContaining(now).start;
  return new Date(
    Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - reconcileLookbackMonths, 1),
  );
}

export function createReconciliation(runtime: BillingRuntime, invoicing: Invoicing) {
  const { repo } = runtime;

  async function findIssues(
    communityId: CommunityId,
    invoice: PlatformInvoiceRecord,
    now: Date,
  ): Promise<IssueInput[]> {
    const base = {
      invoiceId: invoice.id,
      currency: invoice.currency,
      periodStart: invoice.periodStart,
      detectedAt: now,
    };
    const issues: IssueInput[] = [];
    const { totals, accruedBase } = await repo.asBilling(communityId, async (store) => ({
      totals: await store.invoiceTotals(invoice.id),
      accruedBase: await store.ledgerAccruedBase(
        invoice.currency,
        invoice.periodStart,
        invoice.periodEnd,
      ),
    }));
    if (totals.ledgerMinor !== invoice.amountMinor || totals.linesMinor !== invoice.amountMinor) {
      issues.push({
        ...base,
        kind: "ledger_amount_mismatch",
        expectedMinor: totals.ledgerMinor,
        actualMinor: invoice.amountMinor,
      });
    }
    if (!invoice.stripeInvoiceId) {
      if (now.getTime() - invoice.createdAt.getTime() > missingInvoiceGraceMs) {
        issues.push({
          ...base,
          kind: "stripe_invoice_missing",
          expectedMinor: invoice.amountMinor,
          actualMinor: null,
        });
      }
    } else if (invoice.status !== "void") {
      const gateway = requireGateway(runtime);
      const stripeId = invoice.stripeInvoiceId;
      const stripe = await callBillingStripe(runtime, "retrieve_invoice", () =>
        gateway.retrieveInvoice(stripeId),
      );
      if (stripe.totalMinor !== invoice.amountMinor || stripe.currency !== invoice.currency) {
        issues.push({
          ...base,
          kind: "stripe_amount_mismatch",
          expectedMinor: invoice.amountMinor,
          actualMinor: stripe.totalMinor,
        });
      }
    }
    const reported = await runtime.providerTotals({
      communityId,
      currency: invoice.currency,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
    });
    if (reported !== null && reported !== accruedBase) {
      issues.push({
        ...base,
        kind: "provider_total_mismatch",
        expectedMinor: accruedBase,
        actualMinor: reported,
      });
    }
    return issues;
  }

  async function reconcile(
    input: { readonly now?: Date; readonly communityIds?: readonly CommunityId[] } = {},
  ): Promise<ReconcileResult> {
    const now = input.now ?? runtime.now();
    const result = { synced: 0, checked: 0, issues: 0, failed: 0 };
    if (!billingEnabled(runtime) || !runtime.gateway) {
      return result;
    }
    for (const ref of await repo.listUnsettledInvoices(input.communityIds)) {
      try {
        const invoice = await repo.asBilling(ref.communityId, (store) =>
          store.findInvoice(ref.invoiceId),
        );
        if (invoice?.status === "draft") {
          await invoicing.pushInvoice(ref.communityId, ref.invoiceId);
        } else {
          await invoicing.syncInvoice(ref.communityId, ref.invoiceId);
        }
        result.synced += 1;
      } catch (error: unknown) {
        result.failed += 1;
        runtime.log({
          msg: "platform invoice sync failed",
          level: "error",
          communityId: ref.communityId,
          invoiceId: ref.invoiceId,
          error: error instanceof Error ? error.name : "unknown",
        });
      }
    }
    for (const ref of await repo.listInvoicesSince(lookbackStart(now), input.communityIds)) {
      try {
        const invoice = await repo.asBilling(ref.communityId, (store) =>
          store.findInvoice(ref.invoiceId),
        );
        if (!invoice) {
          continue;
        }
        result.checked += 1;
        const issues = await findIssues(ref.communityId, invoice, now);
        const kinds: PlatformBillingIssueKind[] = issues.map((issue) => issue.kind);
        await repo.asBilling(ref.communityId, async (store) => {
          await store.resolveIssues(invoice.currency, invoice.periodStart, kinds, now);
          for (const issue of issues) {
            const created = await store.recordIssue(issue);
            if (created) {
              result.issues += 1;
              runtime.log({
                msg: "platform billing mismatch",
                level: "warn",
                communityId: ref.communityId,
                invoiceId: invoice.id,
                kind: issue.kind,
                currency: issue.currency,
                expectedMinor: issue.expectedMinor,
                actualMinor: issue.actualMinor,
              });
            }
          }
        });
      } catch (error: unknown) {
        result.failed += 1;
        runtime.log({
          msg: "platform invoice reconciliation failed",
          level: "error",
          communityId: ref.communityId,
          invoiceId: ref.invoiceId,
          error: error instanceof Error ? error.name : "unknown",
        });
      }
    }
    runtime.log({ msg: "platform billing reconciled", ...result });
    return result;
  }

  return { reconcile };
}
