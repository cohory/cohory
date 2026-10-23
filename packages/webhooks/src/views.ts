import type {
  WebhookDelivery,
  WebhookDeliveryAttempt,
  WebhookDeliveryStatus,
  WebhookDisabledReason,
  WebhookEndpoint,
  WebhookEndpointStatus,
  WebhookPayload,
} from "@cohory/db/schema";
import type { WebhookEventType } from "@cohory/events";

export interface WebhookEndpointView {
  readonly id: string;
  readonly url: string;
  readonly description: string | null;
  readonly eventTypes: readonly WebhookEventType[];
  readonly status: WebhookEndpointStatus;
  readonly disabledReason: WebhookDisabledReason | null;
  readonly disabledAt: Date | null;
  readonly failingSince: Date | null;
  readonly consecutiveFailures: number;
  readonly lastSuccessAt: Date | null;
  readonly previousSecretExpiresAt: Date | null;
  readonly createdAt: Date;
}

export interface CreatedWebhookEndpoint {
  readonly endpoint: WebhookEndpointView;
  readonly secret: string;
}

export interface WebhookDeliveryView {
  readonly id: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly status: WebhookDeliveryStatus;
  readonly attempts: number;
  readonly responseStatus: number | null;
  readonly lastError: string | null;
  readonly lastAttemptAt: Date | null;
  readonly nextAttemptAt: Date | null;
  readonly createdAt: Date;
}

export interface WebhookDeliveryPage {
  readonly data: readonly WebhookDeliveryView[];
  readonly nextCursor: string | null;
}

export interface WebhookAttemptView {
  readonly at: Date;
  readonly requestHeaders: Readonly<Record<string, string>>;
  readonly requestBody: string;
  readonly responseStatus: number | null;
  readonly responseBodyExcerpt: string | null;
  readonly errorCode: string | null;
  readonly durationMs: number | null;
}

export interface WebhookDeliveryDetail {
  readonly delivery: WebhookDeliveryView;
  readonly payload: WebhookPayload;
  readonly attempts: readonly WebhookAttemptView[];
}

export function toEndpointView(
  row: WebhookEndpoint,
  eventTypes: readonly WebhookEventType[],
  now: Date,
): WebhookEndpointView {
  const overlapEnds =
    row.previousSecretExpiresAt && row.previousSecretExpiresAt > now
      ? row.previousSecretExpiresAt
      : null;
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    eventTypes,
    status: row.status,
    disabledReason: row.disabledReason,
    disabledAt: row.disabledAt,
    failingSince: row.failingSince,
    consecutiveFailures: row.consecutiveFailures,
    lastSuccessAt: row.lastSuccessAt,
    previousSecretExpiresAt: overlapEnds,
    createdAt: row.createdAt,
  };
}

export function toDeliveryView(row: WebhookDelivery): WebhookDeliveryView {
  return {
    id: row.id,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.responseStatus,
    lastError: row.lastError,
    lastAttemptAt: row.lastAttemptAt,
    nextAttemptAt: row.status === "pending" ? row.nextAttemptAt : null,
    createdAt: row.createdAt,
  };
}

export function toAttemptView(row: WebhookDeliveryAttempt): WebhookAttemptView {
  return {
    at: row.attemptedAt,
    requestHeaders: row.requestHeaders,
    requestBody: row.requestBody,
    responseStatus: row.responseStatus,
    responseBodyExcerpt: row.responseBodyExcerpt,
    errorCode: row.errorCode,
    durationMs: row.durationMs,
  };
}
