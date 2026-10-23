import {
  billingWebhookEventJob,
  billingWebhookEventJobPayloadSchema,
  webhookEventJob,
  webhookEventJobPayloadSchema,
  webhookEventQueueOptions,
  webhookSweepJob,
  type BillingWebhookEventJobPayload,
  type WebhookEventJobPayload,
  type WebhookEventOutcome,
  type WebhookSweepResult,
} from "@cohory/payments";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const PAYMENTS_WEBHOOK_PROCESS = webhookEventJob;
export const PAYMENTS_BILLING_WEBHOOK_PROCESS = billingWebhookEventJob;
export const PAYMENTS_WEBHOOK_SWEEP = webhookSweepJob;
export const paymentsWebhookSweepCron = "17 * * * *";

export type ProcessWebhookEvent = (payload: WebhookEventJobPayload) => Promise<WebhookEventOutcome>;
export type ProcessBillingWebhookEvent = (
  payload: BillingWebhookEventJobPayload,
) => Promise<WebhookEventOutcome>;
export type SweepWebhookEvents = () => Promise<WebhookSweepResult>;

interface EventIds {
  readonly providerEventId: string;
  readonly connectionId?: string;
}

function createEventHandler<T extends EventIds>(
  logger: Logger,
  parse: (data: unknown) => T,
  process: (payload: T) => Promise<WebhookEventOutcome>,
  processedMessage: string,
) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const payload = parse(job.data);
      const ids = {
        jobId: job.id,
        job: job.name,
        providerEventId: payload.providerEventId,
        connectionId: payload.connectionId ?? null,
      };
      try {
        const outcome = await process(payload);
        logger.info({ ...ids, outcome }, processedMessage);
      } catch (error: unknown) {
        if (job.retryCount >= webhookEventQueueOptions.retryLimit) {
          logger.error(
            { ...ids, error: error instanceof Error ? error.name : "unknown" },
            "payment webhook retries exhausted; the hourly sweep re-queues it for up to 3 days",
          );
        }
        throw error;
      }
    }
  };
}

export function createPaymentsWebhookHandler(logger: Logger, process: ProcessWebhookEvent) {
  return createEventHandler(
    logger,
    (data) => webhookEventJobPayloadSchema.parse(data),
    process,
    "payment webhook event processed",
  );
}

export function createPaymentsBillingWebhookHandler(
  logger: Logger,
  process: ProcessBillingWebhookEvent,
) {
  return createEventHandler(
    logger,
    (data) => billingWebhookEventJobPayloadSchema.parse(data),
    process,
    "platform billing webhook event processed",
  );
}

export function createPaymentsWebhookSweepHandler(logger: Logger, sweep: SweepWebhookEvents) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await sweep();
      logger.info({ jobId: job.id, job: job.name, ...result }, "payment webhook sweep finished");
    }
  };
}

export const paymentsWebhookJobDefinition: JobDefinition = {
  name: PAYMENTS_WEBHOOK_PROCESS,
  queueOptions: { ...webhookEventQueueOptions },
  payloadSchema: webhookEventJobPayloadSchema,
  handler: ({ logger, deps }) => createPaymentsWebhookHandler(logger, deps.processPaymentWebhook),
};

export const paymentsBillingWebhookJobDefinition: JobDefinition = {
  name: PAYMENTS_BILLING_WEBHOOK_PROCESS,
  queueOptions: { ...webhookEventQueueOptions },
  payloadSchema: billingWebhookEventJobPayloadSchema,
  handler: ({ logger, deps }) =>
    createPaymentsBillingWebhookHandler(logger, deps.processBillingWebhook),
};

export const paymentsWebhookSweepJobDefinition: JobDefinition = {
  name: PAYMENTS_WEBHOOK_SWEEP,
  queueOptions: { policy: "stately" },
  cron: paymentsWebhookSweepCron,
  handler: ({ logger, deps }) => createPaymentsWebhookSweepHandler(logger, deps.sweepWebhookEvents),
};
