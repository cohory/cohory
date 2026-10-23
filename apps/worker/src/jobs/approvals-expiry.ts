import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const APPROVALS_EXPIRY = "approvals.expiry";
export const approvalsExpiryCron = "*/5 * * * *";

export type ExpireApprovals = () => Promise<{ expired: number; interrupted: number }>;

export function createApprovalsExpiryHandler(logger: Logger, run: ExpireApprovals) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      logger.info({ jobId: job.id, job: job.name, ...result }, "approval requests expired");
    }
  };
}

export const approvalsExpiryJobDefinition: JobDefinition = {
  name: APPROVALS_EXPIRY,
  queueOptions: { policy: "stately" },
  cron: approvalsExpiryCron,
  handler: ({ logger, deps }) => createApprovalsExpiryHandler(logger, deps.expireApprovals),
};
