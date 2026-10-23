import type { MoveRetentionResult } from "@cohory/payments";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const PAYMENTS_MOVES_RETENTION = "payments.moves-retention";
export const movesRetentionCron = "23 4 * * *";

export type SweepSubscriberMoves = () => Promise<MoveRetentionResult>;

export function createMovesRetentionHandler(logger: Logger, run: SweepSubscriberMoves) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      logger.info({ jobId: job.id, job: job.name, ...result }, "expired moving offers removed");
    }
  };
}

export const movesRetentionJobDefinition: JobDefinition = {
  name: PAYMENTS_MOVES_RETENTION,
  queueOptions: { policy: "stately" },
  cron: movesRetentionCron,
  handler: ({ logger, deps }) => createMovesRetentionHandler(logger, deps.sweepSubscriberMoves),
};
