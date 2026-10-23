import { feeRemovalJob, feeRemovalJobPayloadSchema, type FeeRemovalResult } from "@cohory/payments";
import type { Job } from "pg-boss";

import { feeRemovalQueueOptions } from "@cohory/payments";
import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const PAYMENTS_FEE_REMOVAL = feeRemovalJob;

export type RemoveApplicationFees = (connectionId: string) => Promise<FeeRemovalResult>;

export function createPaymentsFeeRemovalHandler(logger: Logger, remove: RemoveApplicationFees) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const { connectionId } = feeRemovalJobPayloadSchema.parse(job.data);
      const result = await remove(connectionId);
      logger.info(
        { jobId: job.id, job: job.name, connectionId, cleared: result.cleared },
        "platform fee removed from subscriptions",
      );
    }
  };
}

export const paymentsFeeRemovalJobDefinition: JobDefinition = {
  name: PAYMENTS_FEE_REMOVAL,
  queueOptions: { ...feeRemovalQueueOptions },
  payloadSchema: feeRemovalJobPayloadSchema,
  handler: ({ logger, deps }) =>
    createPaymentsFeeRemovalHandler(logger, deps.removeApplicationFees),
};
