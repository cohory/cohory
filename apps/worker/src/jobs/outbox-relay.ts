import { getDb } from "@cohory/db";
import { pruneOutbox, relayPendingOutbox, type RelayResult } from "@cohory/events";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const OUTBOX_RELAY = "outbox.relay";
export const outboxRelayCron = "* * * * *";
export const outboxRelayBatch = 500;
export const outboxRetentionDays = 7;

const dayMs = 24 * 60 * 60 * 1000;

export interface OutboxRelayDeps {
  relay(limit: number): Promise<RelayResult>;
  prune(publishedBefore: Date): Promise<number>;
  now(): Date;
}

export const defaultOutboxRelayDeps: OutboxRelayDeps = {
  relay: (limit) => relayPendingOutbox({ limit }),
  prune: (publishedBefore) => pruneOutbox(getDb(), publishedBefore),
  now: () => new Date(),
};

export function createOutboxRelayHandler(logger: Logger, deps: OutboxRelayDeps) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      let published = 0;
      let failed = 0;
      let result: RelayResult;
      do {
        result = await deps.relay(outboxRelayBatch);
        published += result.published;
        failed += result.failed;
      } while (result.published === outboxRelayBatch);
      const pruned = await deps.prune(new Date(deps.now().getTime() - outboxRetentionDays * dayMs));
      const log = failed > 0 ? logger.warn.bind(logger) : logger.info.bind(logger);
      log({ jobId: job.id, job: job.name, published, failed, pruned }, "outbox relayed");
    }
  };
}

export const outboxRelayJobDefinition: JobDefinition = {
  name: OUTBOX_RELAY,
  queueOptions: { policy: "stately" },
  cron: outboxRelayCron,
  handler: ({ logger, deps }) => createOutboxRelayHandler(logger, deps.outbox),
};
