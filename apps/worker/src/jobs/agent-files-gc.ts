import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const AGENT_FILES_GC = "courses.agent-files-gc";
export const agentFilesGcCron = "50 4 * * *";

export type CollectAgentFileGarbage = () => Promise<{
  readonly courses: number;
  readonly deleted: number;
  readonly bytes: number;
}>;

export function createAgentFilesGcHandler(logger: Logger, run: CollectAgentFileGarbage) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      logger.info({ jobId: job.id, job: job.name, ...result }, "unused agent files deleted");
    }
  };
}

export const agentFilesGcJobDefinition: JobDefinition = {
  name: AGENT_FILES_GC,
  queueOptions: { policy: "stately" },
  cron: agentFilesGcCron,
  handler: ({ logger, deps }) => createAgentFilesGcHandler(logger, deps.collectAgentFileGarbage),
};
