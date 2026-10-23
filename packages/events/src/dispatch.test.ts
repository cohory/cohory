import type { PostEvent } from "@cohory/posts";
import { describe, expect, it, vi } from "vitest";

import {
  createDomainEventsPublisher,
  createOutboxDispatcher,
  createPostEventsOutboxPublisher,
  createPostEventsSender,
  gamificationPointsJob,
  notificationsDomainJob,
  notificationsWelcomeJob,
  welcomeEmailDelaySeconds,
  notificationsFanoutJob,
  postsMemberEmailJob,
  relayAfterCommit,
  withWebhookFanout,
  type JobQueue,
} from "./dispatch";
import { UnknownOutboxTopicError } from "./outbox";
import { postEventsJobPayloadSchema as fanoutJobPayloadSchema } from "./schema";

const community = "0192f0a0-0000-7000-8000-00000000c001";
const post = "0192f0a0-0000-7000-8000-00000000a001";
const comment = "0192f0a0-0000-7000-8000-00000000b001";
const ada = "0192f0a0-0000-7000-8000-000000000001";
const grace = "0192f0a0-0000-7000-8000-000000000002";
const reaction = "0192f0a0-0000-7000-8000-00000000d001";
const outboxId = "0192f0a0-0000-7000-8000-00000000e001";

const likeAdded: PostEvent = {
  type: "like.added",
  payload: {
    communityId: community,
    reactionId: reaction,
    subjectType: "post",
    subjectId: post,
    subjectAuthorId: ada,
    userId: grace,
    occurredAt: "2026-10-18T10:00:00.000Z",
  },
};

const commentEvents: PostEvent[] = [
  {
    type: "comment.created",
    payload: {
      communityId: community,
      postId: post,
      commentId: comment,
      parentId: null,
      parentAuthorId: null,
      authorId: ada,
      postAuthorId: ada,
      mentionedUserIds: [],
    },
  },
];

function fakeQueue() {
  const send = vi.fn<JobQueue["send"]>().mockResolvedValue("job-id");
  const createQueue = vi.fn<JobQueue["createQueue"]>().mockResolvedValue(undefined);
  return { send, createQueue };
}

describe("createPostEventsSender", () => {
  it("enqueues one fan-out job keyed by the outbox row with a singleton key per subject", async () => {
    const queue = fakeQueue();
    const publish = createPostEventsSender(async () => queue);

    await publish(commentEvents, outboxId);

    expect(queue.createQueue).toHaveBeenCalledWith(notificationsFanoutJob);
    expect(queue.send).toHaveBeenCalledWith(
      notificationsFanoutJob,
      { events: commentEvents },
      expect.objectContaining({ id: outboxId, singletonKey: `comment.created:${comment}` }),
    );
  });

  it("routes like events to both queues and keys them by reaction", async () => {
    const queue = fakeQueue();
    const publish = createPostEventsSender(async () => queue);

    await publish([likeAdded], outboxId);

    expect(queue.send.mock.calls.map((call) => [call[0], call[1], call[2].singletonKey])).toEqual([
      [notificationsFanoutJob, { events: [likeAdded] }, `like.added:${reaction}`],
      [gamificationPointsJob, { events: [likeAdded] }, `like.added:${reaction}`],
    ]);
  });

  it("sends unlikes only to gamification and deletions to notifications too", async () => {
    const queue = fakeQueue();
    const publish = createPostEventsSender(async () => queue);
    const removed: PostEvent = { ...likeAdded, type: "like.removed" };
    const deleted: PostEvent = {
      type: "post.deleted",
      payload: {
        communityId: community,
        postId: post,
        authorId: ada,
        occurredAt: "2026-10-18T10:00:00.000Z",
        likes: [{ reactionId: reaction, subjectAuthorId: ada, userId: grace }],
      },
    };

    await publish([removed], outboxId);
    await publish([deleted], outboxId);

    expect(queue.send.mock.calls.map((call) => call[0])).toEqual([
      gamificationPointsJob,
      notificationsFanoutJob,
      gamificationPointsJob,
    ]);
    expect(fanoutJobPayloadSchema.parse({ events: [removed, deleted] })).toEqual({
      events: [removed, deleted],
    });
  });

  it("sends a new report only to the notifications queue, keyed by the report", async () => {
    const queue = fakeQueue();
    const publish = createPostEventsSender(async () => queue);
    const reported: PostEvent = {
      type: "report.created",
      payload: {
        communityId: community,
        reportId: reaction,
        postId: post,
        commentId: null,
        reporterId: grace,
      },
    };
    await publish([reported], outboxId);
    expect(queue.send.mock.calls.map((call) => [call[0], call[2].singletonKey])).toEqual([
      [notificationsFanoutJob, `report.created:${reaction}`],
    ]);
    expect(fanoutJobPayloadSchema.parse({ events: [reported] })).toEqual({ events: [reported] });
  });

  it("creates the queues once across publishes", async () => {
    const queue = fakeQueue();
    const publish = createPostEventsSender(async () => queue);

    await publish(commentEvents, outboxId);
    await publish(commentEvents, outboxId);

    expect(queue.createQueue).toHaveBeenCalledTimes(3);
    expect(queue.send).toHaveBeenCalledTimes(2);
  });

  it("sends an emailed post only to the member email queue, keyed by the post and time", async () => {
    const queue = fakeQueue();
    const publish = createPostEventsSender(async () => queue);
    const emailed: PostEvent = {
      type: "post.emailed",
      payload: {
        communityId: community,
        postId: post,
        sentBy: ada,
        occurredAt: "2026-10-18T10:00:00.000Z",
      },
    };

    await publish([emailed], outboxId);

    expect(queue.send.mock.calls.map((call) => [call[0], call[2].singletonKey])).toEqual([
      [postsMemberEmailJob, `post.emailed:${post}:2026-10-18T10:00:00.000Z`],
    ]);
    expect(queue.send.mock.calls[0]?.[2]).toMatchObject({ id: outboxId, retryLimit: 0 });
    expect(fanoutJobPayloadSchema.parse({ events: [emailed] })).toEqual({ events: [emailed] });
  });

  it("does nothing for an empty event list", async () => {
    const queue = fakeQueue();
    const publish = createPostEventsSender(async () => queue);

    await publish([], outboxId);

    expect(queue.send).not.toHaveBeenCalled();
  });
});

describe("createPostEventsOutboxPublisher", () => {
  it("sends the events of a post_events row with the row id as job id", async () => {
    const send = vi.fn(async () => undefined);
    const publish = createPostEventsOutboxPublisher(send);

    await publish({
      id: outboxId,
      communityId: community,
      topic: "post_events",
      payload: { events: commentEvents },
      attempts: 0,
    });

    expect(send).toHaveBeenCalledWith(commentEvents, outboxId);
  });

  it("rejects a row whose payload is not a post event batch", async () => {
    const publish = createPostEventsOutboxPublisher(vi.fn(async () => undefined));

    await expect(
      publish({
        id: outboxId,
        communityId: community,
        topic: "post_events",
        payload: { events: [] },
        attempts: 0,
      }),
    ).rejects.toThrow();
  });

  it("refuses a topic it does not own and the dispatcher refuses unknown topics", async () => {
    const row = { id: outboxId, communityId: null, topic: "billing", payload: {}, attempts: 0 };

    await expect(
      createPostEventsOutboxPublisher(vi.fn(async () => undefined))(row),
    ).rejects.toBeInstanceOf(UnknownOutboxTopicError);
    await expect(createOutboxDispatcher({})(row)).rejects.toBeInstanceOf(UnknownOutboxTopicError);
  });
});

describe("relayAfterCommit", () => {
  it("relays only the committed outbox row", async () => {
    const relay = vi.fn(async () => ({ published: 1, failed: 0, errors: [] }));
    const log = { error: vi.fn<(line: string) => void>() };

    await relayAfterCommit(relay, log)({ outboxId, events: commentEvents });

    expect(relay).toHaveBeenCalledWith([outboxId]);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("logs and swallows a relay failure so the write still succeeds", async () => {
    const log = { error: vi.fn<(line: string) => void>() };
    const relay = relayAfterCommit(async () => {
      throw new Error("queue down");
    }, log);

    await expect(relay({ outboxId, events: commentEvents })).resolves.toBeUndefined();

    expect(JSON.parse(log.error.mock.calls[0]?.[0] ?? "{}")).toMatchObject({
      msg: "post events stay in the outbox for the relay job",
      name: "Error",
      outboxId,
      events: ["comment.created"],
    });
  });

  it("logs rows the relay could not publish", async () => {
    const log = { error: vi.fn<(line: string) => void>() };

    await relayAfterCommit(
      async () => ({ published: 0, failed: 1, errors: ["TypeError"] }),
      log,
    )({ outboxId, events: commentEvents });

    expect(JSON.parse(log.error.mock.calls[0]?.[0] ?? "{}")).toMatchObject({ name: "TypeError" });
  });
});

describe("postEventsJobPayloadSchema", () => {
  it("accepts the events the posts service emits", () => {
    expect(fanoutJobPayloadSchema.parse({ events: commentEvents })).toEqual({
      events: commentEvents,
    });
  });

  it("rejects an unknown event type", () => {
    expect(
      fanoutJobPayloadSchema.safeParse({ events: [{ type: "post.exploded", payload: {} }] })
        .success,
    ).toBe(false);
  });

  it("rejects a payload with a malformed id", () => {
    const [event] = commentEvents;
    const broken = { ...event, payload: { ...event?.payload, commentId: "nope" } };

    expect(fanoutJobPayloadSchema.safeParse({ events: [broken] }).success).toBe(false);
  });
});

describe("withWebhookFanout", () => {
  const row = {
    id: outboxId,
    communityId: community,
    topic: "post_events",
    payload: {},
    attempts: 0,
  };

  it("fans out to webhooks after the primary publisher succeeds", async () => {
    const calls: string[] = [];
    const publish = withWebhookFanout(
      async () => {
        calls.push("primary");
      },
      async () => {
        calls.push("webhooks");
      },
    );
    await publish(row);
    expect(calls).toEqual(["primary", "webhooks"]);
  });

  it("does not fan out when the primary publisher fails, so the relay retries both", async () => {
    const fanout = vi.fn().mockResolvedValue(undefined);
    const publish = withWebhookFanout(() => Promise.reject(new Error("queue down")), fanout);
    await expect(publish(row)).rejects.toThrow("queue down");
    expect(fanout).not.toHaveBeenCalled();
  });
});

describe("createDomainEventsPublisher", () => {
  const row = (events: unknown[]) => ({
    id: outboxId,
    communityId: community,
    topic: "domain_events",
    attempts: 0,
    payload: { events },
  });
  const joined = {
    type: "member.joined",
    payload: {
      communityId: community,
      userId: ada,
      role: "member",
      occurredAt: "2026-10-19T08:00:00.000Z",
    },
  };

  it("queues the joins for the notifications job, keyed by the outbox row", async () => {
    const queue = fakeQueue();
    await createDomainEventsPublisher(async () => queue)(row([joined]));
    expect(queue.createQueue).toHaveBeenCalledWith(notificationsDomainJob);
    expect(queue.send).toHaveBeenCalledWith(
      notificationsDomainJob,
      { events: [joined] },
      expect.objectContaining({ id: outboxId, singletonKey: outboxId }),
    );
  });

  it("schedules one welcome email two minutes after a member joins", async () => {
    const queue = fakeQueue();
    await createDomainEventsPublisher(async () => queue)(row([joined]));
    expect(queue.createQueue).toHaveBeenCalledWith(notificationsWelcomeJob);
    expect(queue.send).toHaveBeenCalledWith(
      notificationsWelcomeJob,
      { communityId: community, userId: ada },
      expect.objectContaining({
        startAfter: welcomeEmailDelaySeconds,
        singletonKey: `welcome:${community}:${ada}`,
      }),
    );
    expect(welcomeEmailDelaySeconds).toBe(120);
  });

  it("sends no welcome email to the owner who created the community", async () => {
    const queue = fakeQueue();
    const owner = { ...joined, payload: { ...joined.payload, role: "owner" } };
    await createDomainEventsPublisher(async () => queue)(row([owner]));
    expect(queue.send).not.toHaveBeenCalledWith(
      notificationsWelcomeJob,
      expect.anything(),
      expect.anything(),
    );
  });

  it("queues nothing for domain events no notification needs", async () => {
    const queue = fakeQueue();
    const completed = {
      type: "lesson.completed",
      payload: {
        communityId: community,
        userId: ada,
        courseId: post,
        lessonId: comment,
        occurredAt: "2026-10-19T08:00:00.000Z",
      },
    };
    await createDomainEventsPublisher(async () => queue)(row([completed]));
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("refuses other topics and malformed rows", async () => {
    const publish = createDomainEventsPublisher(async () => fakeQueue());
    await expect(publish({ ...row([joined]), topic: "post_events" })).rejects.toBeInstanceOf(
      UnknownOutboxTopicError,
    );
    await expect(publish(row([{ type: "member.joined", payload: {} }]))).rejects.toThrow();
  });
});
