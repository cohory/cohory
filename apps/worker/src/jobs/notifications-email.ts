import {
  getNotificationEmailJobs,
  notificationsDigestJob,
  notificationsEmailJob,
  type EmailRunResult,
} from "@cohory/notifications";
import type { Job } from "pg-boss";

import { notificationsDigestCron, notificationsEmailCron } from "@cohory/notifications";
import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const NOTIFICATIONS_EMAIL = notificationsEmailJob;
export const NOTIFICATIONS_DIGEST = notificationsDigestJob;

export type SendNotificationEmails = () => Promise<EmailRunResult>;

export function defaultNotificationEmailJobs(appUrl: string, logger: Logger) {
  return getNotificationEmailJobs(appUrl, (error, userId) => {
    logger.warn(
      {
        err: error instanceof Error ? { name: error.name, message: error.message } : undefined,
        userId,
      },
      "notification email not sent",
    );
  });
}

export function createNotificationEmailHandler(
  logger: Logger,
  run: SendNotificationEmails,
  message: string,
) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      const log = result.failed > 0 ? logger.warn.bind(logger) : logger.info.bind(logger);
      log({ jobId: job.id, job: job.name, ...result }, message);
    }
  };
}

export const notificationsEmailJobDefinition: JobDefinition = {
  name: NOTIFICATIONS_EMAIL,
  queueOptions: { policy: "stately" },
  cron: notificationsEmailCron,
  handler: ({ logger, deps }) =>
    createNotificationEmailHandler(logger, deps.sendNotificationEmails, "notification emails sent"),
};

export const notificationsDigestJobDefinition: JobDefinition = {
  name: NOTIFICATIONS_DIGEST,
  queueOptions: { policy: "stately" },
  cron: notificationsDigestCron,
  handler: ({ logger, deps }) =>
    createNotificationEmailHandler(logger, deps.sendNotificationDigests, "daily summaries sent"),
};
