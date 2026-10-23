import { postEventsTopic } from "@cohory/posts";
import { describe, expect, it, vi } from "vitest";

import {
  createCreatorsInviteTrigger,
  creatorsInviteDelaySeconds,
  creatorsInviteJob,
} from "./creators-invite";
import { courseEventsTopic } from "./course-events";
import type { JobQueue } from "./dispatch";
import { domainEventsTopic } from "./domain";
import type { PendingOutboxRow } from "./outbox";

const community = "0192f0a0-0000-7000-8000-00000000c001";
const other = "0192f0a0-0000-7000-8000-00000000c002";
const ada = "0192f0a0-0000-7000-8000-000000000001";
const course = "0192f0a0-0000-7000-8000-00000000f001";
const occurredAt = "2026-10-23T10:00:00.000Z";

function fakeQueue() {
  const send = vi.fn<JobQueue["send"]>().mockResolvedValue("job-id");
  const createQueue = vi.fn<JobQueue["createQueue"]>().mockResolvedValue(undefined);
  return { queue: { send, createQueue }, send, createQueue };
}

function row(topic: string, payload: unknown): PendingOutboxRow {
  return {
    id: "0192f0a0-0000-7000-8000-00000000e001",
    communityId: null,
    topic,
    payload,
    attempts: 0,
  };
}

const ownerJoined = row(domainEventsTopic, {
  events: [
    {
      type: "member.joined",
      payload: { communityId: community, userId: ada, role: "owner", occurredAt },
    },
  ],
});

describe("creators invite trigger", () => {
  it("schedules a check 3 days after a community gets its owner", async () => {
    const { queue, send } = fakeQueue();
    await createCreatorsInviteTrigger(
      async () => queue,
      () => true,
    )(ownerJoined);

    expect(creatorsInviteDelaySeconds).toBe(259_200);
    expect(send).toHaveBeenCalledWith(
      creatorsInviteJob,
      { communityId: community, trigger: "created" },
      expect.objectContaining({
        startAfter: creatorsInviteDelaySeconds,
        singletonKey: `creators-invite:created:${community}`,
      }),
    );
  });

  it("ignores members who join an existing community", async () => {
    const { queue, send } = fakeQueue();
    await createCreatorsInviteTrigger(
      async () => queue,
      () => true,
    )(
      row(domainEventsTopic, {
        events: [
          {
            type: "member.joined",
            payload: { communityId: community, userId: ada, role: "member", occurredAt },
          },
        ],
      }),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("checks right away when a post is published, once per community in the batch", async () => {
    const { queue, send } = fakeQueue();
    const created = (communityId: string, postId: string) => ({
      type: "post.created",
      payload: { communityId, postId, authorId: ada, mentionedUserIds: [] },
    });
    await createCreatorsInviteTrigger(
      async () => queue,
      () => true,
    )(
      row(postEventsTopic, {
        events: [
          created(community, "0192f0a0-0000-7000-8000-00000000a001"),
          created(community, "0192f0a0-0000-7000-8000-00000000a002"),
          created(other, "0192f0a0-0000-7000-8000-00000000a003"),
        ],
      }),
    );
    expect(send.mock.calls.map(([, payload]) => payload)).toEqual([
      { communityId: community, trigger: "post" },
      { communityId: other, trigger: "post" },
    ]);
    expect(send.mock.calls[0]?.[2]).toMatchObject({
      singletonKey: `creators-invite:content:${community}`,
      singletonSeconds: 3600,
    });
    expect(send.mock.calls[0]?.[2]).not.toHaveProperty("startAfter");
  });

  it("checks right away when a course is published", async () => {
    const { queue, send } = fakeQueue();
    await createCreatorsInviteTrigger(
      async () => queue,
      () => true,
    )(
      row(courseEventsTopic, {
        events: [
          {
            type: "course.published",
            payload: { communityId: community, courseId: course, occurredAt },
          },
        ],
      }),
    );
    expect(send).toHaveBeenCalledWith(
      creatorsInviteJob,
      { communityId: community, trigger: "course" },
      expect.objectContaining({ singletonKey: `creators-invite:content:${community}` }),
    );
  });

  it("queues nothing when no creators community is configured", async () => {
    const { queue, send, createQueue } = fakeQueue();
    await createCreatorsInviteTrigger(
      async () => queue,
      () => false,
    )(ownerJoined);
    expect(send).not.toHaveBeenCalled();
    expect(createQueue).not.toHaveBeenCalled();
  });

  it("leaves other topics alone", async () => {
    const { queue, send } = fakeQueue();
    await createCreatorsInviteTrigger(
      async () => queue,
      () => true,
    )(row("membership_events", { events: [] }));
    expect(send).not.toHaveBeenCalled();
  });
});
