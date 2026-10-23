import type { LastSeenBackfillResult } from "@cohory/communities";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const MEMBERS_LAST_SEEN_BACKFILL = "members.last-seen-backfill";
export const lastSeenBackfillCron = "23 4 * * *";

export type BackfillLastSeen = () => Promise<LastSeenBackfillResult>;

export function createLastSeenBackfillHandler(logger: Logger, run: BackfillLastSeen) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      logger.info({ jobId: job.id, job: job.name, ...result }, "member last seen backfilled");
    }
  };
}

export const lastSeenBackfillJobDefinition: JobDefinition = {
  name: MEMBERS_LAST_SEEN_BACKFILL,
  queueOptions: { policy: "stately" },
  cron: lastSeenBackfillCron,
  handler: ({ logger, deps }) => createLastSeenBackfillHandler(logger, deps.backfillLastSeen),
};
