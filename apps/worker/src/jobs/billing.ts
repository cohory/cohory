import type { InvoiceRunResult, ReconcileResult } from "@cohory/payments/billing";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const BILLING_INVOICE = "billing.invoice";
export const BILLING_RECONCILE = "billing.reconcile";
export const billingInvoiceCron = "15 0 1 * *";
export const billingReconcileCron = "30 3 * * *";

export type GenerateInvoices = () => Promise<InvoiceRunResult>;
export type ReconcileBilling = () => Promise<ReconcileResult>;

export function createBillingInvoiceHandler(logger: Logger, run: GenerateInvoices) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      logger.info({ jobId: job.id, job: job.name, ...result }, "platform invoices generated");
    }
  };
}

export function createBillingReconcileHandler(logger: Logger, run: ReconcileBilling) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      const log = result.issues > 0 || result.failed > 0 ? logger.warn : logger.info;
      log.call(logger, { jobId: job.id, job: job.name, ...result }, "platform billing reconciled");
    }
  };
}

export const billingInvoiceJobDefinition: JobDefinition = {
  name: BILLING_INVOICE,
  queueOptions: { policy: "stately", retryLimit: 3, retryBackoff: true },
  cron: billingInvoiceCron,
  handler: ({ logger, deps }) => createBillingInvoiceHandler(logger, deps.generateInvoices),
};

export const billingReconcileJobDefinition: JobDefinition = {
  name: BILLING_RECONCILE,
  queueOptions: { policy: "stately" },
  cron: billingReconcileCron,
  handler: ({ logger, deps }) => createBillingReconcileHandler(logger, deps.reconcileBilling),
};
