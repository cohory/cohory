import type { PurgeRunResult } from "@cohory/communities";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const COMMUNITIES_PURGE = "communities.purge-deleted";
export const communitiesPurgeCron = "* * * * *";

export type PurgeDeletedCommunities = () => Promise<PurgeRunResult>;

export function createCommunitiesPurgeHandler(logger: Logger, run: PurgeDeletedCommunities) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const { purged, notReady, failed } = await run();
      for (const failure of failed) {
        logger.error({ jobId: job.id, job: job.name, ...failure }, "deleted community not purged");
      }
      logger.info(
        { jobId: job.id, job: job.name, purged, notReady, failed: failed.length },
        "deleted communities purged",
      );
    }
  };
}

export const communitiesPurgeJobDefinition: JobDefinition = {
  name: COMMUNITIES_PURGE,
  queueOptions: { policy: "stately" },
  cron: communitiesPurgeCron,
  handler: ({ logger, deps }) =>
    createCommunitiesPurgeHandler(logger, deps.purgeDeletedCommunities),
};
