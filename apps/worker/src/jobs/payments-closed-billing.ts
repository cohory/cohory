import type { ClosedBillingResult } from "@cohory/payments";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const PAYMENTS_CLOSED_BILLING_SWEEP = "payments.closed-billing-sweep";
export const closedBillingSweepCron = "*/15 * * * *";

export type EndClosedBillingAccess = () => Promise<ClosedBillingResult>;

export function createClosedBillingSweepHandler(logger: Logger, run: EndClosedBillingAccess) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      logger.info(
        { jobId: job.id, job: job.name, ...result },
        "paid access after disconnect ended",
      );
    }
  };
}

export const closedBillingSweepJobDefinition: JobDefinition = {
  name: PAYMENTS_CLOSED_BILLING_SWEEP,
  queueOptions: { policy: "stately" },
  cron: closedBillingSweepCron,
  handler: ({ logger, deps }) =>
    createClosedBillingSweepHandler(logger, deps.endClosedBillingAccess),
};
