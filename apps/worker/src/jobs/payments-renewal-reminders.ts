import { renewalReminderEmail, type EmailMessage } from "@cohory/email";
import {
  renewalReminderJob,
  renewalReminderSchema,
  type RenewalReminder,
  type RenewalReminderMessage,
} from "@cohory/payments";
import type { Job } from "pg-boss";

import { renewalReminderQueueOptions } from "@cohory/payments";
import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const PAYMENTS_RENEWAL_REMINDERS = "payments.renewal-reminders";
export const PAYMENTS_RENEWAL_REMINDER = renewalReminderJob;
export const renewalRemindersCron = "41 9 * * *";

export type QueueRenewalReminders = () => Promise<{ readonly queued: number }>;
export type PrepareRenewalReminder = (
  reminder: RenewalReminder,
) => Promise<RenewalReminderMessage | null>;
export type SendRenewalEmail = (message: EmailMessage) => Promise<void>;

export function createRenewalRemindersHandler(logger: Logger, run: QueueRenewalReminders) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      logger.info({ jobId: job.id, job: job.name, ...result }, "renewal reminders queued");
    }
  };
}

export function createRenewalReminderHandler(
  logger: Logger,
  appUrl: string,
  prepare: PrepareRenewalReminder,
  send: SendRenewalEmail,
) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const reminder = renewalReminderSchema.parse(job.data);
      const context = {
        jobId: job.id,
        job: job.name,
        communityId: reminder.communityId,
        subscriptionId: reminder.subscriptionId,
      };
      const message = await prepare(reminder);
      if (!message) {
        logger.info(context, "renewal reminder skipped");
        continue;
      }
      const content = renewalReminderEmail({
        communityName: message.communityName,
        amountMinor: message.amountMinor,
        currency: message.currency,
        renewsAt: message.renewsAt,
        membershipUrl: `${appUrl}/c/${encodeURIComponent(message.communitySlug)}/membership`,
      });
      await send({ to: message.email, ...content });
      logger.info(context, "renewal reminder sent");
    }
  };
}

export const renewalRemindersJobDefinition: JobDefinition = {
  name: PAYMENTS_RENEWAL_REMINDERS,
  queueOptions: { policy: "stately" },
  cron: renewalRemindersCron,
  handler: ({ logger, deps }) => createRenewalRemindersHandler(logger, deps.queueRenewalReminders),
};

export const renewalReminderJobDefinition: JobDefinition = {
  name: PAYMENTS_RENEWAL_REMINDER,
  queueOptions: renewalReminderQueueOptions,
  payloadSchema: renewalReminderSchema,
  handler: ({ logger, deps }) =>
    createRenewalReminderHandler(
      logger,
      deps.appUrl,
      deps.prepareRenewalReminder,
      deps.sendRenewalEmail,
    ),
};
