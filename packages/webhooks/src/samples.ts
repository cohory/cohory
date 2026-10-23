import type { WebhookPayload } from "@cohory/db/schema";
import type { WebhookEventType, WebhookSourceEvent } from "@cohory/events";

import { testEventType, testWebhookPayload, toWebhookPayload } from "./catalog";

const communityId = "0192f0a0-0000-7000-8000-00000000c001";
const userId = "0192f0a0-0000-7000-8000-000000000001";
const postId = "0192f0a0-0000-7000-8000-00000000a001";
const reviewId = "0192f0a0-0000-7000-8000-00000000d001";
const occurredAt = "2026-10-19T10:00:00.000Z";

type SourceEventOf<K extends WebhookEventType> = Extract<WebhookSourceEvent, { type: K }>;

export const sampleSourceEvents: { readonly [K in WebhookEventType]: SourceEventOf<K> } = {
  "post.created": {
    type: "post.created",
    payload: { communityId, postId, authorId: userId, mentionedUserIds: [] },
  },
  "comment.created": {
    type: "comment.created",
    payload: {
      communityId,
      postId,
      commentId: "0192f0a0-0000-7000-8000-00000000b001",
      parentId: null,
      parentAuthorId: null,
      authorId: userId,
      postAuthorId: userId,
      mentionedUserIds: [],
    },
  },
  "member.joined": {
    type: "member.joined",
    payload: { communityId, userId, role: "member", occurredAt },
  },
  "member.removed": {
    type: "member.removed",
    payload: { communityId, userId, status: "removed", reason: "left", occurredAt },
  },
  "lesson.completed": {
    type: "lesson.completed",
    payload: {
      communityId,
      userId,
      courseId: "0192f0a0-0000-7000-8000-00000000e001",
      lessonId: "0192f0a0-0000-7000-8000-00000000e002",
      occurredAt,
    },
  },
  "event.rsvp_changed": {
    type: "event.rsvp_changed",
    payload: {
      communityId,
      userId,
      eventId: "0192f0a0-0000-7000-8000-00000000f001",
      occurrenceId: "0192f0a0-0000-7000-8000-00000000f002",
      status: "going",
      occurredAt,
    },
  },
  "subscription.activated": {
    type: "subscription.activated",
    payload: {
      communityId,
      userId,
      subscriptionId: "0192f0a0-0000-7000-8000-000000005001",
      planId: "0192f0a0-0000-7000-8000-000000005002",
      occurredAt,
    },
  },
  "subscription.ended": {
    type: "subscription.ended",
    payload: {
      communityId,
      userId,
      subscriptionId: "0192f0a0-0000-7000-8000-000000005001",
      planId: "0192f0a0-0000-7000-8000-000000005002",
      occurredAt,
    },
  },
  "review.created": {
    type: "review.created",
    payload: { communityId, reviewId, authorId: userId, rating: 5, occurredAt },
  },
  "review.updated": {
    type: "review.updated",
    payload: { communityId, reviewId, authorId: userId, rating: 4, occurredAt },
  },
  "review.deleted": {
    type: "review.deleted",
    payload: { communityId, reviewId, occurredAt },
  },
  "review.hidden": {
    type: "review.hidden",
    payload: { communityId, reviewId, reason: "spam", occurredAt },
  },
};

export type SampleWebhookPayloads = Readonly<
  Record<WebhookEventType | typeof testEventType, WebhookPayload>
>;

export function sampleWebhookPayloads(): SampleWebhookPayloads {
  const at = new Date(occurredAt);
  const entries = Object.values(sampleSourceEvents).map(
    (event) => [event.type, toWebhookPayload(event, at)] as const,
  );
  return {
    ...(Object.fromEntries(entries) as Record<WebhookEventType, WebhookPayload>),
    [testEventType]: testWebhookPayload(communityId, "0192f0a0-0000-7000-8000-000000009001", at),
  };
}
