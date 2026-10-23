import { webhookEventTypes, webhookSourceEventSchema } from "@cohory/events";
import { describe, expect, it } from "vitest";

import { testEventType } from "./catalog";
import { sampleSourceEvents, sampleWebhookPayloads } from "./samples";

describe("sample payloads", () => {
  it("has a valid source event for every published event type", () => {
    for (const type of webhookEventTypes) {
      const event = sampleSourceEvents[type];
      expect(event.type).toBe(type);
      expect(webhookSourceEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it("shapes each sample exactly like a real delivery body", () => {
    const samples = sampleWebhookPayloads();
    expect(Object.keys(samples).sort()).toEqual([...webhookEventTypes, testEventType].sort());
    expect(samples["post.created"]).toEqual({
      type: "post.created",
      timestamp: "2026-10-19T10:00:00.000Z",
      data: {
        communityId: expect.any(String),
        postId: expect.any(String),
        authorId: expect.any(String),
        agentId: null,
      },
    });
    expect(Object.keys(samples["member.removed"].data).sort()).toEqual([
      "communityId",
      "reason",
      "status",
      "userId",
    ]);
    expect(samples[testEventType].data).toEqual({
      communityId: expect.any(String),
      endpointId: expect.any(String),
    });
  });
});
