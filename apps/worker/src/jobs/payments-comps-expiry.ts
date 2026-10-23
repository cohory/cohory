import type { CompExpiryResult } from "@cohory/payments";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const PAYMENTS_COMPS_EXPIRY = "payments.comps-expiry";
export const compsExpiryCron = "41 * * * *";

export type ExpireComps = () => Promise<CompExpiryResult>;

export function createCompsExpiryHandler(logger: Logger, run: ExpireComps) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      logger.info({ jobId: job.id, job: job.name, ...result }, "expired comped access ended");
    }
  };
}

export const compsExpiryJobDefinition: JobDefinition = {
  name: PAYMENTS_COMPS_EXPIRY,
  queueOptions: { policy: "stately" },
  cron: compsExpiryCron,
  handler: ({ logger, deps }) => createCompsExpiryHandler(logger, deps.expireComps),
};
