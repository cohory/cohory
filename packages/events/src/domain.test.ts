import { describe, expect, it, vi } from "vitest";

import { domainEventsTopic, domainEventsPayloadSchema } from "./domain";
import type { PendingOutboxRow } from "./outbox";
import {
  createWebhookFanoutPublisher,
  webhookEventsOf,
  webhookFanoutJobPayloadSchema,
  webhooksFanoutJob,
  type WebhookFanoutQueue,
} from "./webhooks";

const community = "0192f0a0-0000-7000-8000-00000000c001";
const ada = "0192f0a0-0000-7000-8000-000000000001";
const post = "0192f0a0-0000-7000-8000-00000000a001";
const outboxId = "0192f0a0-0000-7000-8000-00000000e001";
const occurredAt = "2026-10-19T08:00:00.000Z";

function row(topic: string, payload: unknown): PendingOutboxRow {
  return { id: outboxId, communityId: community, topic, payload, attempts: 0 };
}

function fakeQueue() {
  return {
    send: vi.fn<WebhookFanoutQueue["send"]>().mockResolvedValue("job"),
    createQueue: vi.fn<WebhookFanoutQueue["createQueue"]>().mockResolvedValue(undefined),
  };
}

describe("domainEventsPayloadSchema", () => {
  it("accepts the rows the database triggers write", () => {
    const parsed = domainEventsPayloadSchema.parse({
      events: [
        {
          type: "member.joined",
          payload: { communityId: community, userId: ada, role: "member", occurredAt },
        },
      ],
    });
    expect(parsed.events[0]?.type).toBe("member.joined");
  });

  it("rejects an unknown event type", () => {
    expect(() =>
      domainEventsPayloadSchema.parse({
        events: [{ type: "member.renamed", payload: { communityId: community } }],
      }),
    ).toThrow();
  });
});

describe("webhookEventsOf", () => {
  it("keeps only the published event types of a post events row", () => {
    const events = webhookEventsOf(
      row("post_events", {
        events: [
          {
            type: "post.created",
            payload: { communityId: community, postId: post, authorId: ada, mentionedUserIds: [] },
          },
          {
            type: "mention.created",
            payload: {
              communityId: community,
              subjectType: "post",
              subjectId: post,
              postId: post,
              authorId: ada,
              mentionedUserId: ada,
            },
          },
        ],
      }),
    );
    expect(events.map((event) => event.type)).toEqual(["post.created"]);
  });

  it("reads domain events rows", () => {
    const events = webhookEventsOf(
      row(domainEventsTopic, {
        events: [
          {
            type: "member.removed",
            payload: { communityId: community, userId: ada, status: "banned", occurredAt },
          },
        ],
      }),
    );
    expect(events).toEqual([
      {
        type: "member.removed",
        payload: { communityId: community, userId: ada, status: "banned", occurredAt },
      },
    ]);
  });

  it("ignores topics that carry no published events", () => {
    expect(webhookEventsOf(row("membership.events", { events: [] }))).toEqual([]);
  });
});

describe("createWebhookFanoutPublisher", () => {
  it("sends one fan-out job keyed by the outbox row", async () => {
    const queue = fakeQueue();
    const publish = createWebhookFanoutPublisher(async () => queue);
    await publish(
      row(domainEventsTopic, {
        events: [
          {
            type: "member.joined",
            payload: { communityId: community, userId: ada, role: "member", occurredAt },
          },
        ],
      }),
    );
    expect(queue.createQueue).toHaveBeenCalledWith(webhooksFanoutJob);
    const [name, data, options] = queue.send.mock.calls[0] ?? [];
    expect(name).toBe(webhooksFanoutJob);
    expect(options).toMatchObject({ id: outboxId });
    expect(webhookFanoutJobPayloadSchema.parse(data)).toMatchObject({
      outboxId,
      communityId: community,
    });
  });

  it("sends nothing when no event is published to webhooks", async () => {
    const queue = fakeQueue();
    await createWebhookFanoutPublisher(async () => queue)(
      row("post_events", {
        events: [
          {
            type: "like.added",
            payload: {
              communityId: community,
              reactionId: post,
              subjectType: "post",
              subjectId: post,
              subjectAuthorId: ada,
              userId: ada,
              occurredAt,
            },
          },
        ],
      }),
    );
    expect(queue.send).not.toHaveBeenCalled();
  });
});
