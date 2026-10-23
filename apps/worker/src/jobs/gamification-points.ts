import { gamificationPointsJob, postEventsJobPayloadSchema } from "@cohory/events";
import type { PointsResult } from "@cohory/gamification";
import type { PostEvent } from "@cohory/posts";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const GAMIFICATION_POINTS = gamificationPointsJob;

export type RecordPoints = (events: readonly PostEvent[]) => Promise<PointsResult>;

export function createGamificationPointsHandler(logger: Logger, recordPoints: RecordPoints) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const { events } = postEventsJobPayloadSchema.parse(job.data);
      const { inserted } = await recordPoints(events);
      logger.info(
        { jobId: job.id, job: job.name, events: events.length, inserted },
        "points recorded",
      );
    }
  };
}

export const gamificationPointsJobDefinition: JobDefinition = {
  name: GAMIFICATION_POINTS,
  queueOptions: { retryLimit: 5, retryBackoff: true },
  payloadSchema: postEventsJobPayloadSchema,
  handler: ({ logger, deps }) => createGamificationPointsHandler(logger, deps.recordPoints),
};
