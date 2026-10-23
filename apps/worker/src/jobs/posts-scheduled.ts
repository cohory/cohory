import type { RelayResult } from "@cohory/events";
import type { PublishDueResult } from "@cohory/posts";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const POSTS_PUBLISH_SCHEDULED = "posts.publish-scheduled";
export const publishScheduledCron = "* * * * *";

export interface PublishScheduledDeps {
  publishDue(): Promise<PublishDueResult>;
  relay(outboxIds: readonly string[]): Promise<RelayResult>;
}

export function createPublishScheduledHandler(logger: Logger, deps: PublishScheduledDeps) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await deps.publishDue();
      const outboxIds = result.published.map((item) => item.outboxId);
      let relayFailed = 0;
      if (outboxIds.length > 0) {
        try {
          relayFailed = (await deps.relay(outboxIds)).failed;
        } catch (error: unknown) {
          relayFailed = outboxIds.length;
          logger.warn(
            { jobId: job.id, name: error instanceof Error ? error.name : "unknown" },
            "scheduled post events stay in the outbox for the relay job",
          );
        }
      }
      const log =
        result.errors.length > 0 || relayFailed > 0
          ? logger.warn.bind(logger)
          : logger.info.bind(logger);
      log(
        {
          jobId: job.id,
          job: job.name,
          published: outboxIds.length,
          discarded: result.discarded,
          failed: result.errors.length,
          errors: result.errors,
          relayFailed,
        },
        "scheduled posts published",
      );
    }
  };
}

export const publishScheduledJobDefinition: JobDefinition = {
  name: POSTS_PUBLISH_SCHEDULED,
  queueOptions: { policy: "stately" },
  cron: publishScheduledCron,
  handler: ({ logger, deps }) => createPublishScheduledHandler(logger, deps.scheduledPosts),
};
