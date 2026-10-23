import { getDb } from "@cohory/db";
import { createEgress, egressOptionsFromEnv } from "@cohory/egress";
import { getMailer } from "@cohory/email";

import type { Keyring } from "@cohory/payments/crypto";

import { webhookKeyFromEnv } from "./env";
import { reencryptWebhookSecrets } from "./rotation";
import { createWebhookJobs, type WebhookJobs } from "./jobs";
import { getDeliveryQueue } from "./queue";
import { createWebhooksService, type WebhooksService } from "./service";

export { maxDeliveryAttempts, nextAttemptDelayMs, retryScheduleMs } from "./backoff";
export { testEventType, toWebhookPayload } from "./catalog";
export { openWebhookSecret, sealWebhookSecret, webhookKeyFromEnv } from "./env";
export { sampleWebhookPayloads, type SampleWebhookPayloads } from "./samples";
export {
  WebhookDeliveryNotFoundError,
  WebhookEndpointDisabledError,
  WebhookEndpointLimitError,
  WebhookEndpointNotFoundError,
  WebhooksError,
  type WebhooksErrorCode,
} from "./errors";
export {
  busyRetryMs,
  createWebhookJobs,
  endpointConcurrency,
  sweepBatch,
  type DeliverResult,
  type WebhookJobs,
  type WebhookJobsDeps,
} from "./jobs";
export {
  createDeliveryQueue,
  getDeliveryQueue,
  webhooksDeliverJob,
  webhooksSweepJob,
  type DeliveryQueue,
  type DeliverySender,
  type EnqueueOptions,
} from "./queue";
export {
  createEndpointInputSchema,
  deliveriesPageSize,
  maxDeliveriesPageSize,
  maxEndpointsPerCommunity,
  maxResendBatch,
  secretOverlapMs,
  updateEndpointInputSchema,
  type CreateEndpointInput,
  type ListDeliveriesInput,
  type ResendFailedInput,
  type RotateSecretInput,
  type UpdateEndpointInput,
} from "./schemas";
export { createWebhooksService, type WebhooksService, type WebhooksServiceDeps } from "./service";
export {
  generateWebhookSecret,
  signWebhook,
  verifyWebhook,
  webhookHeaders,
  WebhookVerificationError,
} from "./signature";
export type {
  CreatedWebhookEndpoint,
  WebhookAttemptView,
  WebhookDeliveryDetail,
  WebhookDeliveryPage,
  WebhookDeliveryView,
  WebhookEndpointView,
} from "./views";

let key: Keyring | undefined;

function sharedKey(): Keyring {
  key ??= webhookKeyFromEnv();
  return key;
}

let defaultService: WebhooksService | undefined;

export function getWebhooksService(): WebhooksService {
  defaultService ??= createWebhooksService({
    db: getDb(),
    key: sharedKey,
    queue: getDeliveryQueue(),
    allowPrivateHosts: egressOptionsFromEnv().allowPrivateHosts,
  });
  return defaultService;
}

export function getWebhookJobs(
  appUrl: string,
  log?: (line: Record<string, unknown>) => void,
): WebhookJobs {
  return createWebhookJobs({
    db: getDb(),
    key: sharedKey,
    egress: createEgress({ ...egressOptionsFromEnv(), timeoutMs: 10_000, maxResponseBytes: 4096 }),
    queue: getDeliveryQueue(),
    mailer: getMailer(),
    appUrl,
    log,
  });
}

export function rotateStoredWebhookSecrets() {
  return reencryptWebhookSecrets(getDb(), sharedKey());
}
export { reencryptWebhookSecrets, type WebhookSecretRotationResult } from "./rotation";
