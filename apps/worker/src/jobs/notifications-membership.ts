import { membershipEventsJobPayloadSchema, notificationsMembershipJob } from "@cohory/events";
import type { MembershipNotifier } from "@cohory/notifications";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const NOTIFICATIONS_MEMBERSHIP = notificationsMembershipJob;

export function createNotificationsMembershipHandler(logger: Logger, notify: MembershipNotifier) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const { events } = membershipEventsJobPayloadSchema.parse(job.data);
      const { inserted } = await notify(events);
      logger.info(
        { jobId: job.id, job: job.name, events: events.length, inserted },
        "membership notifications created",
      );
    }
  };
}

export const notificationsMembershipJobDefinition: JobDefinition = {
  name: NOTIFICATIONS_MEMBERSHIP,
  queueOptions: { retryLimit: 5, retryBackoff: true },
  payloadSchema: membershipEventsJobPayloadSchema,
  handler: ({ logger, deps }) =>
    createNotificationsMembershipHandler(logger, deps.notifyMembership),
};
