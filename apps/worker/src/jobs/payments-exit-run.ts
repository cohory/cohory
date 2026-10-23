import type { CompletedDeletion } from "@cohory/communities";
import type { CommunityId } from "@cohory/db";
import {
  exitRunJob,
  exitRunJobPayloadSchema,
  PaymentsNotFoundError,
  type ExitRunJobPayload,
  type ExitRunResult,
} from "@cohory/payments";
import type { Job } from "pg-boss";

import { exitRunQueueOptions } from "@cohory/payments";
import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const PAYMENTS_EXIT_RUN = exitRunJob;

export type RunExitRun = (payload: ExitRunJobPayload) => Promise<ExitRunResult>;

export type CompleteCommunityDeletion = (communityId: CommunityId) => Promise<CompletedDeletion>;

export function createPaymentsExitRunHandler(
  logger: Logger,
  runExit: RunExitRun,
  completeDeletion: CompleteCommunityDeletion,
) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const payload = exitRunJobPayloadSchema.parse(job.data);
      let result: ExitRunResult;
      try {
        result = await runExit(payload);
      } catch (error: unknown) {
        if (error instanceof PaymentsNotFoundError) {
          logger.warn(
            { jobId: job.id, job: job.name, runId: payload.runId, subject: error.subject },
            "exit run skipped because its community or run is gone",
          );
          continue;
        }
        throw error;
      }
      logger.info(
        {
          jobId: job.id,
          job: job.name,
          runId: payload.runId,
          kind: result.kind,
          status: result.status,
        },
        "exit run processed",
      );
      if (result.kind !== "delete" || result.status !== "done") {
        continue;
      }
      const deletion = await completeDeletion(result.communityId);
      const fields = { jobId: job.id, job: job.name, runId: payload.runId, deletion };
      if (deletion === "deleted") {
        logger.info(fields, "community deleted after its subscriptions were cancelled");
      } else {
        logger.warn(fields, "community deletion is waiting after its subscriptions were cancelled");
      }
    }
  };
}

export const paymentsExitRunJobDefinition: JobDefinition = {
  name: PAYMENTS_EXIT_RUN,
  queueOptions: { ...exitRunQueueOptions },
  payloadSchema: exitRunJobPayloadSchema,
  handler: ({ logger, deps }) =>
    createPaymentsExitRunHandler(logger, deps.runExitRun, deps.completeCommunityDeletion),
};
