import type { HoldExpiryResult } from "@cohory/payments";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const PAYMENTS_HOLDS_EXPIRY = "payments.holds-expiry";
export const holdsExpiryCron = "23 * * * *";

export type ExpireHolds = () => Promise<HoldExpiryResult>;

export function createHoldsExpiryHandler(logger: Logger, run: ExpireHolds) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      logger.info({ jobId: job.id, job: job.name, ...result }, "expired invite holds released");
    }
  };
}

export const holdsExpiryJobDefinition: JobDefinition = {
  name: PAYMENTS_HOLDS_EXPIRY,
  queueOptions: { policy: "stately" },
  cron: holdsExpiryCron,
  handler: ({ logger, deps }) => createHoldsExpiryHandler(logger, deps.expireHolds),
};
