import { membershipEventsTopic } from "@cohory/communities";
import { describe, expect, it, vi } from "vitest";

import { createMembershipEventsPublisher, notificationsMembershipJob } from "./membership";
import { UnknownOutboxTopicError, type PendingOutboxRow } from "./outbox";

const communityId = "0192f2a4-0000-7000-8000-000000000001";
const requestId = "0192f2a4-0000-7000-8000-000000000002";
const userId = "0192f2a4-0000-7000-8000-000000000003";

function row(payload: unknown, topic = membershipEventsTopic): PendingOutboxRow {
  return { id: "0192f2a4-0000-7000-8000-0000000000aa", communityId, topic, payload, attempts: 0 };
}

function fakeQueue() {
  return {
    createQueue: vi.fn(async () => undefined),
    send: vi.fn(async () => "job-id"),
  };
}

describe("membership events publisher", () => {
  it("sends join request events to the notifications.membership queue once per outbox row", async () => {
    const queue = fakeQueue();
    const publish = createMembershipEventsPublisher(async () => queue);
    const events = [{ type: "join_request.created", payload: { communityId, requestId, userId } }];

    await publish(row({ events }));
    await publish(row({ events }));

    expect(queue.createQueue).toHaveBeenCalledOnce();
    expect(queue.send).toHaveBeenCalledWith(
      notificationsMembershipJob,
      { events },
      expect.objectContaining({
        id: "0192f2a4-0000-7000-8000-0000000000aa",
        singletonKey: `join_request.created:${requestId}`,
      }),
    );
  });

  it("sends an ownership transfer once per notice", async () => {
    const queue = fakeQueue();
    const publish = createMembershipEventsPublisher(async () => queue);
    const noticeId = "0192f2a4-0000-7000-8000-000000000004";
    const events = [
      {
        type: "ownership.transferred",
        payload: { communityId, noticeId, previousOwnerId: userId, newOwnerId: requestId },
      },
    ];

    await publish(row({ events }));

    expect(queue.send).toHaveBeenCalledWith(
      notificationsMembershipJob,
      { events },
      expect.objectContaining({ singletonKey: `ownership.transferred:${noticeId}` }),
    );
  });

  it("rejects malformed payloads and other topics", async () => {
    const publish = createMembershipEventsPublisher(async () => fakeQueue());
    await expect(publish(row({ events: [{ type: "join_request.created" }] }))).rejects.toThrow();
    await expect(publish(row({ events: [] }, "post.events"))).rejects.toBeInstanceOf(
      UnknownOutboxTopicError,
    );
  });
});
