import {
  notificationsPaidMembershipJob,
  paidMembershipEventsJobPayloadSchema,
} from "@cohory/events";
import type { PaidMembershipNotifier } from "@cohory/notifications";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const NOTIFICATIONS_PAID_MEMBERSHIP = notificationsPaidMembershipJob;

export const paidMembershipQueueOptions = { retryLimit: 5, retryBackoff: true } as const;

export function createNotificationsPaidMembershipHandler(
  logger: Logger,
  notify: PaidMembershipNotifier,
) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const { events } = paidMembershipEventsJobPayloadSchema.parse(job.data);
      const { inserted, emailed } = await notify(events);
      logger.info(
        { jobId: job.id, job: job.name, events: events.length, inserted, emailed },
        "paid membership notices sent",
      );
    }
  };
}

export const notificationsPaidMembershipJobDefinition: JobDefinition = {
  name: NOTIFICATIONS_PAID_MEMBERSHIP,
  queueOptions: { ...paidMembershipQueueOptions },
  payloadSchema: paidMembershipEventsJobPayloadSchema,
  handler: ({ logger, deps }) =>
    createNotificationsPaidMembershipHandler(logger, deps.notifyPaidMembership),
};
