import { postEventsTopic } from "@cohory/posts";
import type { SendOptions } from "pg-boss";
import { z } from "zod";

import { domainEventSchema, domainEventsPayloadSchema, domainEventsTopic } from "./domain";
import type { OutboxPublisher, PendingOutboxRow } from "./outbox";
import {
  commentCreatedEventSchema,
  postCreatedEventSchema,
  postEventsJobPayloadSchema,
} from "./schema";

export const webhooksFanoutJob = "webhooks.fanout";

export const webhookEventTypes = [
  "post.created",
  "comment.created",
  "member.joined",
  "member.removed",
  "lesson.completed",
  "event.rsvp_changed",
  "subscription.activated",
  "subscription.ended",
  "review.created",
  "review.updated",
  "review.deleted",
  "review.hidden",
] as const;

export type WebhookEventType = (typeof webhookEventTypes)[number];

const published: ReadonlySet<string> = new Set(webhookEventTypes);

export function isWebhookEventType(value: string): value is WebhookEventType {
  return published.has(value);
}

export const webhookSourceEventSchema = z.discriminatedUnion("type", [
  postCreatedEventSchema,
  commentCreatedEventSchema,
  ...domainEventSchema.options,
]);

export type WebhookSourceEvent = z.infer<typeof webhookSourceEventSchema>;

export const webhookFanoutJobPayloadSchema = z.strictObject({
  outboxId: z.uuid(),
  communityId: z.uuid(),
  events: z.array(webhookSourceEventSchema).min(1).max(200),
});

export type WebhookFanoutJobPayload = z.infer<typeof webhookFanoutJobPayloadSchema>;

function sourceEvents(row: PendingOutboxRow): readonly { readonly type: string }[] {
  if (row.topic === postEventsTopic) {
    return postEventsJobPayloadSchema.parse(row.payload).events;
  }
  if (row.topic === domainEventsTopic) {
    return domainEventsPayloadSchema.parse(row.payload).events;
  }
  return [];
}

export function webhookEventsOf(row: PendingOutboxRow): WebhookSourceEvent[] {
  return sourceEvents(row)
    .filter((event) => isWebhookEventType(event.type))
    .map((event) => webhookSourceEventSchema.parse(event));
}

export interface WebhookFanoutQueue {
  createQueue(name: string): Promise<void>;
  send(name: string, data: object, options: SendOptions): Promise<string | null>;
}

export function createWebhookFanoutPublisher(
  getQueue: () => Promise<WebhookFanoutQueue>,
): OutboxPublisher {
  let ready: Promise<WebhookFanoutQueue> | undefined;
  function queue(): Promise<WebhookFanoutQueue> {
    ready ??= getQueue().then(async (q) => {
      await q.createQueue(webhooksFanoutJob);
      return q;
    });
    ready.catch(() => {
      ready = undefined;
    });
    return ready;
  }
  return async (row) => {
    const events = webhookEventsOf(row);
    if (events.length === 0 || !row.communityId) {
      return;
    }
    const payload: WebhookFanoutJobPayload = {
      outboxId: row.id,
      communityId: row.communityId,
      events,
    };
    await (
      await queue()
    ).send(webhooksFanoutJob, payload, { id: row.id, retryLimit: 5, retryBackoff: true });
  };
}
