import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const OAUTH_CLIENTS_PRUNE = "agents.oauth_clients_prune";
export const oauthClientsPruneCron = "55 3 * * *";

export type PruneOAuthClients = () => Promise<{ scanned: number; pruned: number }>;

export function createOAuthClientsPruneHandler(logger: Logger, run: PruneOAuthClients) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      logger.info({ jobId: job.id, job: job.name, ...result }, "unused oauth clients pruned");
    }
  };
}

export const oauthClientsPruneJobDefinition: JobDefinition = {
  name: OAUTH_CLIENTS_PRUNE,
  queueOptions: { policy: "stately" },
  cron: oauthClientsPruneCron,
  handler: ({ logger, deps }) => createOAuthClientsPruneHandler(logger, deps.pruneOAuthClients),
};
