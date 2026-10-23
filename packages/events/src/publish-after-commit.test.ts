import { newId } from "@cohory/db";
import { createPostsService, PostNotFoundError } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import { describe, expect, it, vi } from "vitest";

import {
  createPostEventsOutboxPublisher,
  createPostEventsSender,
  gamificationPointsJob,
  notificationsFanoutJob,
  type JobQueue,
} from "./dispatch";

function doc(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function setup() {
  const repo = createFakePostsRepository();
  const communityId = newId();
  repo.addCommunity(communityId);
  const author = newId();
  const commenter = newId();
  for (const userId of [author, commenter]) {
    repo.addMember(communityId, userId);
    repo.addUser(userId, "Person");
  }
  const send = vi.fn<JobQueue["send"]>().mockResolvedValue("job");
  const createQueue = vi.fn<JobQueue["createQueue"]>().mockResolvedValue(undefined);
  const publishRow = createPostEventsOutboxPublisher(
    createPostEventsSender(async () => ({ send, createQueue })),
  );
  const posts = createPostsService({
    repo,
    storage: {
      put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
      publicUrl: (key) => key,
    },
    onEvents: async ({ outboxId }) => {
      const row = repo.outbox.find((entry) => entry.id === outboxId);
      if (!row) throw new Error("the outbox row was not written in the write");
      await publishRow({
        id: row.id,
        communityId: row.communityId,
        topic: "post_events",
        payload: { events: row.events },
        attempts: 0,
      });
    },
  });
  const user = (userId: string) => ({ kind: "user" as const, userId, platformAdmin: false });
  return { posts, communityId, author: user(author), commenter: user(commenter), send };
}

describe("posts service with the outbox publisher", () => {
  it("enqueues the events of a new post and a new comment after the write", async () => {
    const { posts, communityId, author, commenter, send } = setup();

    const created = await posts.createPost(author, communityId, { body: doc("Hello") });
    const comment = await posts.createComment(commenter, communityId, created.post.id, {
      body: doc("Hi"),
    });

    expect(send.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      [notificationsFanoutJob, { events: created.events }],
      [notificationsFanoutJob, { events: comment.events }],
    ]);
  });

  it("enqueues a like and a deletion for both consumers and an unlike for gamification", async () => {
    const { posts, communityId, author, commenter, send } = setup();
    const { post } = await posts.createPost(author, communityId, { body: doc("Hello") });
    const like = { subjectType: "post" as const, subjectId: post.id };
    send.mockClear();

    await posts.toggleLike(commenter, communityId, { ...like, liked: true });
    await posts.toggleLike(commenter, communityId, { ...like, liked: false });
    await posts.deletePost(author, communityId, post.id);

    expect(send.mock.calls.map((call) => call[0])).toEqual([
      notificationsFanoutJob,
      gamificationPointsJob,
      gamificationPointsJob,
      notificationsFanoutJob,
      gamificationPointsJob,
    ]);
  });

  it("enqueues nothing when the write fails", async () => {
    const { posts, communityId, commenter, send } = setup();

    await expect(
      posts.createComment(commenter, communityId, newId(), { body: doc("Hi") }),
    ).rejects.toBeInstanceOf(PostNotFoundError);
    expect(send).not.toHaveBeenCalled();
  });
});
