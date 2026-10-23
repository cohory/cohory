import { domainEventsPayloadSchema, notificationsDomainJob } from "@cohory/events";
import type { JoinNotifier } from "@cohory/notifications";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const NOTIFICATIONS_DOMAIN = notificationsDomainJob;

export function createNotificationsDomainHandler(logger: Logger, notify: JoinNotifier) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const { events } = domainEventsPayloadSchema.parse(job.data);
      const { inserted } = await notify(events);
      logger.info(
        { jobId: job.id, job: job.name, events: events.length, inserted },
        "join notifications created",
      );
    }
  };
}

export const notificationsDomainJobDefinition: JobDefinition = {
  name: NOTIFICATIONS_DOMAIN,
  queueOptions: { retryLimit: 5, retryBackoff: true },
  payloadSchema: domainEventsPayloadSchema,
  handler: ({ logger, deps }) => createNotificationsDomainHandler(logger, deps.notifyJoins),
};
