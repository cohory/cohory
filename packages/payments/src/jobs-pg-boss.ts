import { getQueueDatabase } from "@cohory/db";
import { PgBoss } from "pg-boss";

import {
  billingWebhookEventJob,
  exitRunJob,
  exitRunQueueOptions,
  feeRemovalJob,
  memberBillingEndJob,
  memberBillingEndQueueOptions,
  reconcileConnectionJob,
  reconcileConnectionQueueOptions,
  webhookEventJob,
  webhookEventQueueOptions,
  type PaymentsJobs,
} from "./jobs";
import {
  renewalReminderJob,
  renewalReminderJobId,
  renewalReminderQueueOptions,
} from "./service/renewal-reminders";

export const feeRemovalQueueOptions = { retryLimit: 8, retryBackoff: true } as const;

export function createPgBossPaymentsJobs(): PaymentsJobs {
  let ready: Promise<PgBoss> | undefined;

  function queue(): Promise<PgBoss> {
    ready ??= (async () => {
      const boss = new PgBoss({
        db: getQueueDatabase(),
        supervise: false,
        schedule: false,
      });
      await boss.start();
      await boss.createQueue(feeRemovalJob, feeRemovalQueueOptions);
      await boss.createQueue(exitRunJob, exitRunQueueOptions);
      await boss.createQueue(memberBillingEndJob, memberBillingEndQueueOptions);
      await boss.createQueue(webhookEventJob, webhookEventQueueOptions);
      await boss.createQueue(billingWebhookEventJob, webhookEventQueueOptions);
      await boss.createQueue(reconcileConnectionJob, reconcileConnectionQueueOptions);
      await boss.createQueue(renewalReminderJob, renewalReminderQueueOptions);
      return boss;
    })();
    ready.catch(() => {
      ready = undefined;
    });
    return ready;
  }

  return {
    async scheduleFeeRemoval(payload) {
      const boss = await queue();
      await boss.send(feeRemovalJob, payload, { singletonKey: payload.connectionId });
    },

    async scheduleExitRun(payload) {
      const boss = await queue();
      await boss.send(exitRunJob, payload, { ...exitRunQueueOptions, singletonKey: payload.runId });
    },

    async scheduleMemberBillingEnd(payload) {
      const boss = await queue();
      await boss.send(memberBillingEndJob, payload, {
        ...memberBillingEndQueueOptions,
        singletonKey: `${payload.communityId}:${payload.userId}`,
      });
    },

    async scheduleWebhookEvent(payload) {
      const boss = await queue();
      await boss.send(webhookEventJob, payload, { singletonKey: payload.providerEventId });
    },

    async scheduleBillingWebhookEvent(payload) {
      const boss = await queue();
      await boss.send(billingWebhookEventJob, payload, { singletonKey: payload.providerEventId });
    },

    async scheduleConnectionReconcile(payload) {
      const boss = await queue();
      await boss.send(reconcileConnectionJob, payload, { singletonKey: payload.connectionId });
    },

    async scheduleRenewalReminder(reminder) {
      const boss = await queue();
      await boss.send(renewalReminderJob, reminder, { id: renewalReminderJobId(reminder) });
    },
  };
}
