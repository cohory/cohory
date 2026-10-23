import type { PgBoss } from "pg-boss";
import { z } from "zod";

import { defaultFanoutPollSeconds } from "./env";
import { accountPurgeJobDefinition } from "./jobs/account-purge";
import { agentFilesGcJobDefinition } from "./jobs/agent-files-gc";
import { approvalsExpiryJobDefinition } from "./jobs/approvals-expiry";
import { billingInvoiceJobDefinition, billingReconcileJobDefinition } from "./jobs/billing";
import {
  calendarExtendJobDefinition,
  calendarNoticeJobDefinition,
  calendarRemindersJobDefinition,
  calendarTimeChangeJobDefinition,
} from "./jobs/calendar";
import { creatorsInviteJobDefinition } from "./jobs/communities-creators-invite";
import { communitiesPurgeJobDefinition } from "./jobs/communities-purge";
import type { JobDefinition, JobHandler, JobRunOptions } from "./jobs/definition";
import { delegationsSweepJobDefinition } from "./jobs/delegations-sweep";
import { emailSendJobDefinition } from "./jobs/email-send";
import { learningPointsJobDefinition } from "./jobs/gamification-learning";
import {
  feedbackMomentsJobDefinition,
  feedbackRetentionJobDefinition,
} from "./jobs/feedback-moments";
import { gamificationPointsJobDefinition } from "./jobs/gamification-points";
import { healthPingJobDefinition } from "./jobs/health-ping";
import { lastSeenBackfillJobDefinition } from "./jobs/members-last-seen";
import { migrationFilesExpiryJobDefinition, migrationJobDefinitions } from "./jobs/migration";
import { notificationsDomainJobDefinition } from "./jobs/notifications-domain";
import { oauthClientsPruneJobDefinition } from "./jobs/oauth-clients-prune";
import {
  notificationsDigestJobDefinition,
  notificationsEmailJobDefinition,
} from "./jobs/notifications-email";
import { notificationsFanoutJobDefinition } from "./jobs/notifications-fanout";
import { notificationsMembershipJobDefinition } from "./jobs/notifications-membership";
import { notificationsPaidMembershipJobDefinition } from "./jobs/notifications-paid-membership";
import { weeklyDigestJobDefinition } from "./jobs/notifications-weekly-digest";
import { notificationsWelcomeJobDefinition } from "./jobs/notifications-welcome";
import { outboxRelayJobDefinition } from "./jobs/outbox-relay";
import { closedBillingSweepJobDefinition } from "./jobs/payments-closed-billing";
import { compsExpiryJobDefinition } from "./jobs/payments-comps-expiry";
import { paymentsExitRunJobDefinition } from "./jobs/payments-exit-run";
import { paymentsFeeRemovalJobDefinition } from "./jobs/payments-fee-removal";
import { holdsExpiryJobDefinition } from "./jobs/payments-holds-expiry";
import { paymentsMemberBillingEndJobDefinition } from "./jobs/payments-member-billing";
import { movesRetentionJobDefinition } from "./jobs/payments-moves-retention";
import {
  paymentsReconcileConnectionJobDefinition,
  paymentsReconcileJobDefinition,
} from "./jobs/payments-reconcile";
import {
  renewalReminderJobDefinition,
  renewalRemindersJobDefinition,
} from "./jobs/payments-renewal-reminders";
import {
  paymentsBillingWebhookJobDefinition,
  paymentsWebhookJobDefinition,
  paymentsWebhookSweepJobDefinition,
} from "./jobs/payments-webhooks";
import { postsMemberEmailJobDefinition } from "./jobs/posts-member-email";
import { publishScheduledJobDefinition } from "./jobs/posts-scheduled";
import { secretsReencryptJobDefinition } from "./jobs/secrets-reencrypt";
import { tokensExpiryNoticeJobDefinition } from "./jobs/tokens-expiry";
import {
  webhooksDeliverJobDefinition,
  webhooksFanoutJobDefinition,
  webhooksSweepJobDefinition,
} from "./jobs/webhooks";
import type { Logger } from "./logger";
import { defaultJobDeps, type JobDeps } from "./services";

export type JobRegistry = Pick<PgBoss, "createQueue" | "work" | "schedule">;

export const jobDefinitions: readonly JobDefinition[] = [
  healthPingJobDefinition,
  notificationsFanoutJobDefinition,
  notificationsMembershipJobDefinition,
  notificationsDomainJobDefinition,
  notificationsWelcomeJobDefinition,
  creatorsInviteJobDefinition,
  notificationsPaidMembershipJobDefinition,
  gamificationPointsJobDefinition,
  feedbackMomentsJobDefinition,
  feedbackRetentionJobDefinition,
  learningPointsJobDefinition,
  calendarRemindersJobDefinition,
  calendarExtendJobDefinition,
  calendarTimeChangeJobDefinition,
  calendarNoticeJobDefinition,
  outboxRelayJobDefinition,
  publishScheduledJobDefinition,
  postsMemberEmailJobDefinition,
  paymentsFeeRemovalJobDefinition,
  paymentsExitRunJobDefinition,
  communitiesPurgeJobDefinition,
  paymentsMemberBillingEndJobDefinition,
  paymentsWebhookJobDefinition,
  paymentsBillingWebhookJobDefinition,
  paymentsWebhookSweepJobDefinition,
  paymentsReconcileJobDefinition,
  paymentsReconcileConnectionJobDefinition,
  notificationsEmailJobDefinition,
  notificationsDigestJobDefinition,
  weeklyDigestJobDefinition,
  accountPurgeJobDefinition,
  compsExpiryJobDefinition,
  movesRetentionJobDefinition,
  holdsExpiryJobDefinition,
  renewalRemindersJobDefinition,
  renewalReminderJobDefinition,
  closedBillingSweepJobDefinition,
  ...migrationJobDefinitions,
  migrationFilesExpiryJobDefinition,
  billingInvoiceJobDefinition,
  billingReconcileJobDefinition,
  lastSeenBackfillJobDefinition,
  webhooksFanoutJobDefinition,
  webhooksDeliverJobDefinition,
  webhooksSweepJobDefinition,
  approvalsExpiryJobDefinition,
  delegationsSweepJobDefinition,
  tokensExpiryNoticeJobDefinition,
  oauthClientsPruneJobDefinition,
  secretsReencryptJobDefinition,
  agentFilesGcJobDefinition,
  emailSendJobDefinition,
];

/**
 * Checks each payload against the queue's schema before the handler runs, so a malformed job fails
 * with the queue named. Handlers still get the raw data: some schemas transform (ISO strings to
 * dates), and handlers parse again to get typed values.
 */
export function withPayloadValidation(definition: JobDefinition, handler: JobHandler): JobHandler {
  const schema = definition.payloadSchema;
  if (!schema) {
    return handler;
  }
  return async (jobs) => {
    for (const job of jobs) {
      const parsed = schema.safeParse(job.data);
      if (!parsed.success) {
        throw new Error(
          `Job payload for queue "${definition.name}" is invalid: ${z.prettifyError(parsed.error)}`,
        );
      }
    }
    await handler(jobs);
  };
}

export async function registerJobs(
  boss: JobRegistry,
  logger: Logger,
  deps: JobDeps = defaultJobDeps("http://localhost:3000", logger),
  options: JobRunOptions = { fanoutPollSeconds: defaultFanoutPollSeconds },
): Promise<void> {
  for (const definition of jobDefinitions) {
    if (definition.queueOptions) {
      await boss.createQueue(definition.name, definition.queueOptions);
    } else {
      await boss.createQueue(definition.name);
    }
    const handler = withPayloadValidation(
      definition,
      definition.handler({ logger, deps, options }),
    );
    if (definition.workOptions) {
      await boss.work(definition.name, definition.workOptions(options), handler);
    } else {
      await boss.work(definition.name, handler);
    }
    if (definition.cron) {
      await boss.schedule(definition.name, definition.cron);
    }
  }
  logger.info(
    { queues: jobDefinitions.map((definition) => definition.name) },
    "job handlers registered",
  );
}
