import { webhookFanoutJobPayloadSchema, webhooksFanoutJob } from "@cohory/events";
import {
  webhooksDeliverJob,
  webhooksSweepJob,
  type DeliverResult,
  type WebhookJobs,
} from "@cohory/webhooks";
import type { Job } from "pg-boss";
import { z } from "zod";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const WEBHOOKS_FANOUT = webhooksFanoutJob;
export const WEBHOOKS_DELIVER = webhooksDeliverJob;
export const WEBHOOKS_SWEEP = webhooksSweepJob;
export const webhooksSweepCron = "* * * * *";
export const webhooksDeliverConcurrency = 8;

export type WebhookJobsDeps = Pick<WebhookJobs, "fanout" | "deliver" | "sweep">;

const deliverPayloadSchema = z.strictObject({ deliveryId: z.uuid() });

export function createWebhooksFanoutHandler(logger: Logger, jobs: WebhookJobsDeps) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const payload = webhookFanoutJobPayloadSchema.parse(job.data);
      const { created } = await jobs.fanout(payload);
      logger.info(
        { jobId: job.id, job: job.name, outboxId: payload.outboxId, created },
        "webhook deliveries created",
      );
    }
  };
}

function logLevel(result: DeliverResult): "info" | "warn" {
  return result.kind === "failed" || result.kind === "endpoint_disabled" ? "warn" : "info";
}

export function createWebhooksDeliverHandler(logger: Logger, jobs: WebhookJobsDeps) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const { deliveryId } = deliverPayloadSchema.parse(job.data);
      const result = await jobs.deliver(deliveryId);
      logger[logLevel(result)](
        { jobId: job.id, job: job.name, deliveryId, ...result },
        "webhook delivery attempted",
      );
    }
  };
}

export function createWebhooksSweepHandler(logger: Logger, jobs: WebhookJobsDeps) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const { enqueued } = await jobs.sweep();
      logger.info({ jobId: job.id, job: job.name, enqueued }, "webhook deliveries swept");
    }
  };
}

export const webhooksFanoutJobDefinition: JobDefinition = {
  name: WEBHOOKS_FANOUT,
  queueOptions: { retryLimit: 5, retryBackoff: true },
  payloadSchema: webhookFanoutJobPayloadSchema,
  handler: ({ logger, deps }) => createWebhooksFanoutHandler(logger, deps.webhooks),
};

export const webhooksDeliverJobDefinition: JobDefinition = {
  name: WEBHOOKS_DELIVER,
  queueOptions: { retryLimit: 2, retryBackoff: true },
  workOptions: () => ({ localConcurrency: webhooksDeliverConcurrency }),
  payloadSchema: deliverPayloadSchema,
  handler: ({ logger, deps }) => createWebhooksDeliverHandler(logger, deps.webhooks),
};

export const webhooksSweepJobDefinition: JobDefinition = {
  name: WEBHOOKS_SWEEP,
  queueOptions: { policy: "stately" },
  cron: webhooksSweepCron,
  handler: ({ logger, deps }) => createWebhooksSweepHandler(logger, deps.webhooks),
};
