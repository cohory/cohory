import type { CreatorMoment } from "@cohory/db/schema";
import {
  feedbackMomentPayloadSchema,
  feedbackMomentsJob,
  type FeedbackMomentPayload,
} from "@cohory/events";
import type { RecordMomentOutcome } from "@cohory/notifications/creator-feedback";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const FEEDBACK_MOMENTS = feedbackMomentsJob;

export type RecordMoment = (moment: FeedbackMomentPayload) => Promise<RecordMomentOutcome>;

export interface MomentCounts {
  posts(communityId: string): Promise<number>;
  courses(communityId: string): Promise<number>;
  paidMembers(communityId: string): Promise<number>;
}

const countFor: Record<CreatorMoment, keyof MomentCounts> = {
  first_post: "posts",
  first_course: "courses",
  first_paid_member: "paidMembers",
};

// A moment arrives after its event commits, so the event's own row is already counted.
export async function isFirstMoment(
  counts: MomentCounts,
  communityId: string,
  moment: CreatorMoment,
): Promise<boolean> {
  return (await counts[countFor[moment]](communityId)) === 1;
}

export function createFeedbackMomentsHandler(logger: Logger, record: RecordMoment) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const moment = feedbackMomentPayloadSchema.parse(job.data);
      const outcome = await record(moment);
      logger.info(
        { jobId: job.id, job: job.name, moment: moment.moment, outcome },
        "creator moment checked",
      );
    }
  };
}

export const feedbackMomentsJobDefinition: JobDefinition = {
  name: FEEDBACK_MOMENTS,
  queueOptions: { retryLimit: 3, retryBackoff: true },
  payloadSchema: feedbackMomentPayloadSchema,
  handler: ({ logger, deps }) => createFeedbackMomentsHandler(logger, deps.recordMoment),
};

export const FEEDBACK_RETENTION = "feedback.retention";
export const feedbackRetentionCron = "41 4 * * *";

export type RemoveExpiredFeedback = () => Promise<number>;

export function createFeedbackRetentionHandler(logger: Logger, run: RemoveExpiredFeedback) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const removed = await run();
      logger.info({ jobId: job.id, job: job.name, removed }, "expired creator feedback removed");
    }
  };
}

export const feedbackRetentionJobDefinition: JobDefinition = {
  name: FEEDBACK_RETENTION,
  queueOptions: { policy: "stately" },
  cron: feedbackRetentionCron,
  handler: ({ logger, deps }) => createFeedbackRetentionHandler(logger, deps.removeExpiredFeedback),
};
