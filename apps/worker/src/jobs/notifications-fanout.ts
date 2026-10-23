import {
  fanoutJobPayloadSchema,
  notificationsFanoutJob,
  type NotificationsFanout,
} from "@cohory/notifications";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const NOTIFICATIONS_FANOUT = notificationsFanoutJob;

export function createNotificationsFanoutHandler(logger: Logger, fanOut: NotificationsFanout) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const { events } = fanoutJobPayloadSchema.parse(job.data);
      const { inserted } = await fanOut(events);
      logger.info(
        { jobId: job.id, job: job.name, events: events.length, inserted },
        "notifications fanned out",
      );
    }
  };
}

export const notificationsFanoutJobDefinition: JobDefinition = {
  name: NOTIFICATIONS_FANOUT,
  queueOptions: { retryLimit: 5, retryBackoff: true },
  workOptions: (options) => ({ pollingIntervalSeconds: options.fanoutPollSeconds }),
  payloadSchema: fanoutJobPayloadSchema,
  handler: ({ logger, deps }) => createNotificationsFanoutHandler(logger, deps.fanOutNotifications),
};
