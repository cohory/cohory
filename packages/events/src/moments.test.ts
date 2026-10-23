import { describe, expect, it, vi } from "vitest";

import {
  createFeedbackMomentsPublisher,
  feedbackMomentsJob,
  feedbackMomentPayloadSchema,
  momentsOf,
  type FeedbackMomentsQueue,
} from "./moments";
import type { PendingOutboxRow } from "./outbox";

const community = "0192f0a0-0000-7000-8000-00000000c001";
const ada = "0192f0a0-0000-7000-8000-000000000001";
const post = "0192f0a0-0000-7000-8000-00000000a001";
const course = "0192f0a0-0000-7000-8000-00000000b001";
const subscription = "0192f0a0-0000-7000-8000-00000000d001";
const occurredAt = "2026-10-19T08:00:00.000Z";

function row(topic: string, payload: unknown): PendingOutboxRow {
  return {
    id: "0192f0a0-0000-7000-8000-00000000e001",
    communityId: community,
    topic,
    payload,
    attempts: 0,
  };
}

const postCreated = row("post_events", {
  events: [
    {
      type: "post.created",
      payload: { communityId: community, postId: post, authorId: ada, mentionedUserIds: [] },
    },
  ],
});

const coursePublished = row("course_events", {
  events: [
    { type: "course.published", payload: { communityId: community, courseId: course, occurredAt } },
  ],
});

const paidMember = row("domain_events", {
  events: [
    {
      type: "subscription.activated",
      payload: {
        communityId: community,
        userId: ada,
        subscriptionId: subscription,
        planId: null,
        occurredAt,
      },
    },
  ],
});

function fakeQueue() {
  return {
    send: vi.fn<FeedbackMomentsQueue["send"]>().mockResolvedValue("job"),
    createQueue: vi.fn<FeedbackMomentsQueue["createQueue"]>().mockResolvedValue(undefined),
  };
}

describe("momentsOf", () => {
  it("maps a created post, a published course, and an activated subscription to their moments", () => {
    expect(momentsOf(postCreated)).toEqual([{ communityId: community, moment: "first_post" }]);
    expect(momentsOf(coursePublished)).toEqual([
      { communityId: community, moment: "first_course" },
    ]);
    expect(momentsOf(paidMember)).toEqual([
      { communityId: community, moment: "first_paid_member" },
    ]);
  });

  it("ignores every other event and topic", () => {
    expect(
      momentsOf(
        row("domain_events", {
          events: [
            {
              type: "member.joined",
              payload: { communityId: community, userId: ada, role: "member", occurredAt },
            },
          ],
        }),
      ),
    ).toEqual([]);
    expect(momentsOf(row("membership_events", { events: [] }))).toEqual([]);
  });
});

describe("createFeedbackMomentsPublisher", () => {
  it("queues one moment job per community and moment on the Cloud Edition", async () => {
    const queue = fakeQueue();
    const publish = createFeedbackMomentsPublisher(
      async () => queue,
      () => true,
    );

    await publish(postCreated);

    expect(queue.createQueue).toHaveBeenCalledWith(feedbackMomentsJob);
    expect(queue.send).toHaveBeenCalledWith(
      feedbackMomentsJob,
      { communityId: community, moment: "first_post" },
      expect.objectContaining({ singletonKey: `${community}:first_post` }),
    );
    const [, payload] = queue.send.mock.calls[0] ?? [];
    expect(feedbackMomentPayloadSchema.parse(payload)).toEqual({
      communityId: community,
      moment: "first_post",
    });
  });

  it("queues nothing on the Community Edition", async () => {
    const queue = fakeQueue();
    const getQueue = vi.fn(async () => queue);
    const publish = createFeedbackMomentsPublisher(getQueue, () => false);

    await publish(postCreated);
    await publish(paidMember);

    expect(getQueue).not.toHaveBeenCalled();
    expect(queue.send).not.toHaveBeenCalled();
  });
});
