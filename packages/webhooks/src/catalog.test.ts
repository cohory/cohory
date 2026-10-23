import type { WebhookSourceEvent } from "@cohory/events";
import { describe, expect, it } from "vitest";

import { toWebhookPayload } from "./catalog";

const communityId = "0192f0a0-0000-7000-8000-00000000c001";
const userId = "0192f0a0-0000-7000-8000-000000000001";
const postId = "0192f0a0-0000-7000-8000-00000000a001";
const commentId = "0192f0a0-0000-7000-8000-00000000b001";
const fallback = new Date("2026-10-19T09:00:00.000Z");

describe("toWebhookPayload", () => {
  it("keeps ids only for a new post, dropping mentions", () => {
    const event: WebhookSourceEvent = {
      type: "post.created",
      payload: { communityId, postId, authorId: userId, mentionedUserIds: [userId] },
    };
    expect(toWebhookPayload(event, fallback)).toEqual({
      type: "post.created",
      timestamp: "2026-10-19T09:00:00.000Z",
      data: { communityId, postId, authorId: userId, agentId: null },
    });
  });

  it("adds only the agent id when an agent wrote the post", () => {
    const agentId = "0192f2a4-0000-7000-8000-0000000000a9";
    const event: WebhookSourceEvent = {
      type: "post.created",
      payload: { communityId, postId, authorId: userId, agentId, mentionedUserIds: [] },
    };
    expect(toWebhookPayload(event, fallback).data).toEqual({
      communityId,
      postId,
      authorId: userId,
      agentId,
    });
  });

  it("keeps ids only for a new comment", () => {
    const event: WebhookSourceEvent = {
      type: "comment.created",
      payload: {
        communityId,
        postId,
        commentId,
        parentId: null,
        parentAuthorId: null,
        authorId: userId,
        postAuthorId: userId,
        mentionedUserIds: [],
      },
    };
    expect(toWebhookPayload(event, fallback).data).toEqual({
      communityId,
      postId,
      commentId,
      parentId: null,
      authorId: userId,
      agentId: null,
    });
  });

  it("uses the time the event happened when the event carries it", () => {
    const event: WebhookSourceEvent = {
      type: "subscription.ended",
      payload: {
        communityId,
        userId,
        subscriptionId: postId,
        planId: null,
        occurredAt: "2026-10-18T07:00:00.000Z",
      },
    };
    expect(toWebhookPayload(event, fallback)).toEqual({
      type: "subscription.ended",
      timestamp: "2026-10-18T07:00:00.000Z",
      data: { communityId, userId, subscriptionId: postId, planId: null },
    });
  });

  it("says why a member left, and fills the reason in for events recorded before it existed", () => {
    const occurredAt = "2026-10-18T07:00:00.000Z";
    const left: WebhookSourceEvent = {
      type: "member.removed",
      payload: { communityId, userId, status: "removed", reason: "left", occurredAt },
    };
    const oldBan: WebhookSourceEvent = {
      type: "member.removed",
      payload: { communityId, userId, status: "banned", occurredAt },
    };
    const oldRemoval: WebhookSourceEvent = {
      type: "member.removed",
      payload: { communityId, userId, status: "removed", occurredAt },
    };
    expect(toWebhookPayload(left, fallback).data).toEqual({
      communityId,
      userId,
      status: "removed",
      reason: "left",
    });
    expect(toWebhookPayload(oldBan, fallback).data).toMatchObject({ reason: "banned" });
    expect(toWebhookPayload(oldRemoval, fallback).data).toMatchObject({ reason: "removed" });
  });

  it("sends the review id, author, and rating for a new review but never the text", () => {
    const event: WebhookSourceEvent = {
      type: "review.created",
      payload: {
        communityId,
        reviewId: postId,
        authorId: userId,
        rating: 4,
        occurredAt: "2026-10-18T07:00:00.000Z",
      },
    };
    expect(toWebhookPayload(event, fallback)).toEqual({
      type: "review.created",
      timestamp: "2026-10-18T07:00:00.000Z",
      data: { communityId, reviewId: postId, authorId: userId, rating: 4 },
    });
  });

  it("names the reason when the owner hides a review", () => {
    const event: WebhookSourceEvent = {
      type: "review.hidden",
      payload: {
        communityId,
        reviewId: postId,
        reason: "spam",
        occurredAt: "2026-10-18T07:00:00.000Z",
      },
    };
    expect(toWebhookPayload(event, fallback).data).toEqual({
      communityId,
      reviewId: postId,
      reason: "spam",
    });
  });
});
