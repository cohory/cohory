import type {
  WebhookDeliveryDetail,
  WebhookDeliveryView,
  WebhookEndpointView,
} from "@cohory/webhooks";

export const webhookEventLabels = {
  "post.created": "New post",
  "comment.created": "New comment",
  "member.joined": "Member joined",
  "member.removed": "Member left or was removed",
  "lesson.completed": "Lesson completed",
  "event.rsvp_changed": "RSVP changed",
  "subscription.activated": "Paid membership started",
  "subscription.ended": "Paid membership ended",
  "review.created": "New review",
  "review.updated": "Review edited",
  "review.deleted": "Review deleted",
  "review.hidden": "Review hidden by the owner",
} as const;

export type WebhookEventName = keyof typeof webhookEventLabels;

export const webhookEventNames = Object.keys(webhookEventLabels) as WebhookEventName[];

export interface EndpointRow {
  readonly id: string;
  readonly url: string;
  readonly description: string | null;
  readonly eventTypes: readonly WebhookEventName[];
  readonly status: "active" | "disabled";
  readonly disabledReason: "manual" | "failures" | null;
  readonly disabledAt: string | null;
  readonly failingSince: string | null;
  readonly consecutiveFailures: number;
  readonly lastSuccessAt: string | null;
  readonly previousSecretExpiresAt: string | null;
}

export interface DeliveryRow {
  readonly id: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly status: "pending" | "succeeded" | "failed";
  readonly attempts: number;
  readonly responseStatus: number | null;
  readonly lastError: string | null;
  readonly lastAttemptAt: string | null;
  readonly nextAttemptAt: string | null;
  readonly createdAt: string;
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export function toEndpointRow(view: WebhookEndpointView): EndpointRow {
  return {
    id: view.id,
    url: view.url,
    description: view.description,
    eventTypes: [...view.eventTypes],
    status: view.status,
    disabledReason: view.disabledReason,
    disabledAt: iso(view.disabledAt),
    failingSince: iso(view.failingSince),
    consecutiveFailures: view.consecutiveFailures,
    lastSuccessAt: iso(view.lastSuccessAt),
    previousSecretExpiresAt: iso(view.previousSecretExpiresAt),
  };
}

export function toDeliveryRow(view: WebhookDeliveryView): DeliveryRow {
  return {
    id: view.id,
    eventId: view.eventId,
    eventType: view.eventType,
    status: view.status,
    attempts: view.attempts,
    responseStatus: view.responseStatus,
    lastError: view.lastError,
    lastAttemptAt: iso(view.lastAttemptAt),
    nextAttemptAt: iso(view.nextAttemptAt),
    createdAt: view.createdAt.toISOString(),
  };
}

export function eventLabel(type: string): string {
  return type in webhookEventLabels
    ? webhookEventLabels[type as WebhookEventName]
    : type === "webhook.test"
      ? "Test event"
      : type;
}

const errorLabels: Record<string, string> = {
  timeout: "No answer within 10 seconds",
  blocked_address: "Address not allowed",
  connection_failed: "Could not connect",
  endpoint_disabled: "Endpoint turned off",
  secret_unreadable: "Secret could not be read",
};

export function deliveryResult(row: DeliveryRow): string {
  if (row.status === "succeeded") {
    return `Delivered (${row.responseStatus ?? 200})`;
  }
  if (!row.lastError) {
    return "Waiting to send";
  }
  const http = /^http_(\d{3})$/.exec(row.lastError);
  return http ? `Answered ${http[1]}` : (errorLabels[row.lastError] ?? row.lastError);
}

export interface AttemptRow {
  readonly at: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
  readonly responseStatus: number | null;
  readonly responseBodyExcerpt: string | null;
  readonly errorCode: string | null;
  readonly durationMs: number | null;
}

export interface DeliveryDetailRow {
  readonly delivery: DeliveryRow;
  readonly payload: string;
  readonly attempts: readonly AttemptRow[];
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function toDeliveryDetailRow(detail: WebhookDeliveryDetail): DeliveryDetailRow {
  return {
    delivery: toDeliveryRow(detail.delivery),
    payload: JSON.stringify(detail.payload, null, 2),
    attempts: detail.attempts.map((attempt) => ({
      at: attempt.at.toISOString(),
      headers: Object.entries(attempt.requestHeaders).sort(([a], [b]) => a.localeCompare(b)),
      body: prettyJson(attempt.requestBody),
      responseStatus: attempt.responseStatus,
      responseBodyExcerpt: attempt.responseBodyExcerpt,
      errorCode: attempt.errorCode,
      durationMs: attempt.durationMs,
    })),
  };
}

export function attemptResult(attempt: Pick<AttemptRow, "responseStatus" | "errorCode">): string {
  if (attempt.responseStatus !== null) {
    return `Answered ${attempt.responseStatus}`;
  }
  return attempt.errorCode ? (errorLabels[attempt.errorCode] ?? attempt.errorCode) : "Not sent";
}
