import type { WebhookSourceEvent } from "@cohory/events";
import type { WebhookPayload } from "@cohory/db/schema";

function dataOf(event: WebhookSourceEvent): Record<string, unknown> {
  switch (event.type) {
    case "post.created": {
      const { communityId, postId, authorId, agentId } = event.payload;
      return { communityId, postId, authorId, agentId: agentId ?? null };
    }
    case "comment.created": {
      const { communityId, postId, commentId, parentId, authorId, agentId } = event.payload;
      return { communityId, postId, commentId, parentId, authorId, agentId: agentId ?? null };
    }
    case "member.removed": {
      const { communityId, userId, status, reason } = event.payload;
      return {
        communityId,
        userId,
        status,
        reason: reason ?? (status === "banned" ? "banned" : "removed"),
      };
    }
    case "member.joined":
    case "lesson.completed":
    case "event.rsvp_changed":
    case "subscription.activated":
    case "subscription.ended":
    case "review.created":
    case "review.updated":
    case "review.deleted":
    case "review.hidden": {
      return Object.fromEntries(
        Object.entries(event.payload).filter(([key]) => key !== "occurredAt"),
      );
    }
  }
}

function occurredAt(event: WebhookSourceEvent): string | null {
  return "occurredAt" in event.payload ? event.payload.occurredAt : null;
}

export function toWebhookPayload(event: WebhookSourceEvent, fallback: Date): WebhookPayload {
  return {
    type: event.type,
    timestamp: new Date(occurredAt(event) ?? fallback).toISOString(),
    data: dataOf(event),
  };
}

export const testEventType = "webhook.test";

export function testWebhookPayload(
  communityId: string,
  endpointId: string,
  now: Date,
): WebhookPayload {
  return { type: testEventType, timestamp: now.toISOString(), data: { communityId, endpointId } };
}
