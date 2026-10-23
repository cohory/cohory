import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const DELEGATIONS_SWEEP = "entitlements.delegations_sweep";
export const delegationsSweepCron = "20 3 * * *";

export type SweepDelegations = () => Promise<{ ended: number; noticesSent: number }>;

export function createDelegationsSweepHandler(logger: Logger, run: SweepDelegations) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      logger.info({ jobId: job.id, job: job.name, ...result }, "course delegations swept");
    }
  };
}

export const delegationsSweepJobDefinition: JobDefinition = {
  name: DELEGATIONS_SWEEP,
  queueOptions: { policy: "stately" },
  cron: delegationsSweepCron,
  handler: ({ logger, deps }) => createDelegationsSweepHandler(logger, deps.sweepDelegations),
};
