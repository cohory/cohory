import type { PostEvent } from "@cohory/posts";
import { describe, expect, it } from "vitest";

import { pointEntriesFor } from "./points";

const community = "0192f0a0-0000-7000-8000-00000000c001";
const post = "0192f0a0-0000-7000-8000-00000000a001";
const ada = "0192f0a0-0000-7000-8000-000000000001";
const grace = "0192f0a0-0000-7000-8000-000000000002";
const reaction = "0192f0a0-0000-7000-8000-00000000d001";
const at = "2026-10-18T10:00:00.000Z";

function like(type: "like.added" | "like.removed", userId = grace): PostEvent {
  return {
    type,
    payload: {
      communityId: community,
      reactionId: reaction,
      subjectType: "post",
      subjectId: post,
      subjectAuthorId: ada,
      userId,
      occurredAt: at,
    },
  };
}

describe("pointEntriesFor", () => {
  it("grants one point to the author for a like received", () => {
    expect(pointEntriesFor([like("like.added")])).toEqual([
      {
        communityId: community,
        userId: ada,
        delta: 1,
        reason: "like_received",
        sourceType: "reaction",
        sourceId: reaction,
        occurredAt: new Date(at),
      },
    ]);
  });

  it("takes the point back on unlike with the same source", () => {
    expect(pointEntriesFor([like("like.removed")])).toEqual([
      expect.objectContaining({
        userId: ada,
        delta: -1,
        reason: "like_removed",
        sourceId: reaction,
      }),
    ]);
  });

  it("ignores self likes and self unlikes", () => {
    expect(pointEntriesFor([like("like.added", ada), like("like.removed", ada)])).toEqual([]);
  });

  it("takes back every non self like on deleted content", () => {
    const other = "0192f0a0-0000-7000-8000-00000000d002";
    const events: PostEvent[] = [
      {
        type: "post.deleted",
        payload: {
          communityId: community,
          postId: post,
          authorId: ada,
          occurredAt: at,
          likes: [
            { reactionId: reaction, subjectAuthorId: ada, userId: grace },
            { reactionId: other, subjectAuthorId: ada, userId: ada },
          ],
        },
      },
      {
        type: "comment.deleted",
        payload: {
          communityId: community,
          postId: post,
          commentId: post,
          authorId: grace,
          occurredAt: at,
          likes: [{ reactionId: other, subjectAuthorId: grace, userId: ada }],
        },
      },
    ];

    expect(pointEntriesFor(events)).toEqual([
      expect.objectContaining({
        userId: ada,
        delta: -1,
        reason: "post_deleted",
        sourceId: reaction,
      }),
      expect.objectContaining({
        userId: grace,
        delta: -1,
        reason: "comment_deleted",
        sourceId: other,
      }),
    ]);
  });

  it("ignores events that carry no points", () => {
    expect(
      pointEntriesFor([
        {
          type: "post.created",
          payload: { communityId: community, postId: post, authorId: ada, mentionedUserIds: [] },
        },
      ]),
    ).toEqual([]);
  });
});
