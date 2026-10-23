import type { PostEvent } from "@cohory/posts";
import { describe, expect, it } from "vitest";

import { planNotifications } from "./plan";
import type { NotificationDraft } from "./types";

const community = "0192f0a0-0000-7000-8000-00000000c001";
const post = "0192f0a0-0000-7000-8000-00000000a001";
const comment = "0192f0a0-0000-7000-8000-00000000b001";
const parent = "0192f0a0-0000-7000-8000-00000000b002";
const ada = "0192f0a0-0000-7000-8000-000000000001";
const bob = "0192f0a0-0000-7000-8000-000000000002";
const cy = "0192f0a0-0000-7000-8000-000000000003";

function commentCreated(input: {
  author: string;
  postAuthor: string;
  parentId?: string | null;
  parentAuthor?: string | null;
  mentioned?: string[];
}): PostEvent[] {
  const mentioned = input.mentioned ?? [];
  return [
    {
      type: "comment.created",
      payload: {
        communityId: community,
        postId: post,
        commentId: comment,
        parentId: input.parentId ?? null,
        parentAuthorId: input.parentId ? (input.parentAuthor ?? cy) : null,
        authorId: input.author,
        postAuthorId: input.postAuthor,
        mentionedUserIds: mentioned,
      },
    },
    ...mentioned.map((mentionedUserId): PostEvent => ({
      type: "mention.created",
      payload: {
        communityId: community,
        subjectType: "comment",
        subjectId: comment,
        postId: post,
        authorId: input.author,
        mentionedUserId,
      },
    })),
  ];
}

function postCreated(author: string, mentioned: string[]): PostEvent[] {
  return [
    {
      type: "post.created",
      payload: {
        communityId: community,
        postId: post,
        authorId: author,
        mentionedUserIds: mentioned,
      },
    },
    ...mentioned.map((mentionedUserId): PostEvent => ({
      type: "mention.created",
      payload: {
        communityId: community,
        subjectType: "post",
        subjectId: post,
        postId: post,
        authorId: author,
        mentionedUserId,
      },
    })),
  ];
}

function liked(subjectType: "post" | "comment", subjectAuthor: string, liker: string): PostEvent[] {
  return [
    {
      type: "like.added",
      payload: {
        communityId: community,
        reactionId: "0192f0a0-0000-7000-8000-00000000d001",
        subjectType,
        subjectId: subjectType === "post" ? post : comment,
        subjectAuthorId: subjectAuthor,
        userId: liker,
        occurredAt: "2026-10-18T10:00:00.000Z",
      },
    },
  ];
}

type Expected = Pick<
  NotificationDraft,
  "userId" | "actorId" | "type" | "subjectType" | "subjectId"
>;

const cases: { name: string; events: PostEvent[]; expected: Expected[] }[] = [
  {
    name: "a post without mentions notifies nobody",
    events: postCreated(ada, []),
    expected: [],
  },
  {
    name: "a mention in a post notifies the mentioned member",
    events: postCreated(ada, [bob]),
    expected: [
      { userId: bob, actorId: ada, type: "mention", subjectType: "post", subjectId: post },
    ],
  },
  {
    name: "a comment notifies the post author",
    events: commentCreated({ author: bob, postAuthor: ada }),
    expected: [
      {
        userId: ada,
        actorId: bob,
        type: "comment_on_post",
        subjectType: "comment",
        subjectId: comment,
      },
    ],
  },
  {
    name: "a comment by the post author notifies nobody",
    events: commentCreated({ author: ada, postAuthor: ada }),
    expected: [],
  },
  {
    name: "a reply notifies the parent comment author and the post author",
    events: commentCreated({ author: bob, postAuthor: ada, parentId: parent }),
    expected: [
      { userId: cy, actorId: bob, type: "reply", subjectType: "comment", subjectId: comment },
      {
        userId: ada,
        actorId: bob,
        type: "comment_on_post",
        subjectType: "comment",
        subjectId: comment,
      },
    ],
  },
  {
    name: "a reply to your own comment notifies only the post author",
    events: commentCreated({ author: cy, postAuthor: ada, parentId: parent }),
    expected: [
      {
        userId: ada,
        actorId: cy,
        type: "comment_on_post",
        subjectType: "comment",
        subjectId: comment,
      },
    ],
  },
  {
    name: "a reply to the post author's comment collapses into one reply",
    events: commentCreated({ author: bob, postAuthor: cy, parentId: parent }),
    expected: [
      { userId: cy, actorId: bob, type: "reply", subjectType: "comment", subjectId: comment },
    ],
  },
  {
    name: "a mention of the post author collapses the comment notification into the mention",
    events: commentCreated({ author: bob, postAuthor: ada, mentioned: [ada] }),
    expected: [
      { userId: ada, actorId: bob, type: "mention", subjectType: "comment", subjectId: comment },
    ],
  },
  {
    name: "a mention of the parent author collapses the reply into the mention",
    events: commentCreated({ author: bob, postAuthor: ada, parentId: parent, mentioned: [cy] }),
    expected: [
      { userId: cy, actorId: bob, type: "mention", subjectType: "comment", subjectId: comment },
      {
        userId: ada,
        actorId: bob,
        type: "comment_on_post",
        subjectType: "comment",
        subjectId: comment,
      },
    ],
  },
  {
    name: "a self mention notifies nobody",
    events: [
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
    expected: [],
  },
  {
    name: "a like on a post is left to the grouped notices",
    events: liked("post", ada, bob),
    expected: [],
  },
  {
    name: "a like on a comment is left to the grouped notices",
    events: liked("comment", bob, ada),
    expected: [],
  },
];

describe("planNotifications", () => {
  it("keeps the first line of the comment as the preview", () => {
    const [created, mention] = commentCreated({ author: bob, postAuthor: ada, mentioned: [cy] });
    if (created?.type !== "comment.created" || mention?.type !== "mention.created") {
      throw new Error("unexpected events");
    }
    const drafts = planNotifications([
      { ...created, payload: { ...created.payload, preview: "Love the glaze" } },
      { ...mention, payload: { ...mention.payload, preview: "Love the glaze" } },
    ]);

    expect(drafts.map((draft) => [draft.type, draft.preview])).toEqual([
      ["comment_on_post", "Love the glaze"],
      ["mention", "Love the glaze"],
    ]);
  });

  it.each(cases)("$name", ({ events, expected }) => {
    const drafts = planNotifications(events);

    expect(
      drafts.map(({ userId, actorId, type, subjectType, subjectId }) => ({
        userId,
        actorId,
        type,
        subjectType,
        subjectId,
      })),
    ).toEqual(expected);
    for (const draft of drafts) {
      expect(draft.communityId).toBe(community);
      expect(draft.postId).toBe(post);
    }
  });

  it("emits one draft per recipient and subject when events repeat", () => {
    const events = [...postCreated(ada, [bob]), ...postCreated(ada, [bob])];

    expect(planNotifications(events)).toHaveLength(1);
  });

  it("skips the reply when the event carries no parent author", () => {
    const events = commentCreated({ author: bob, postAuthor: ada, parentId: parent }).map(
      (event) =>
        event.type === "comment.created"
          ? { ...event, payload: { ...event.payload, parentAuthorId: null } }
          : event,
    );

    expect(planNotifications(events).map((draft) => draft.type)).toEqual(["comment_on_post"]);
  });
});

describe("report outcomes", () => {
  it("tells each reporter what happened to the post or comment they reported", () => {
    const drafts = planNotifications([
      {
        type: "report.resolved",
        payload: {
          communityId: community,
          postId: post,
          commentId: comment,
          reporterIds: [ada, bob],
          resolution: "content_removed",
          resolvedBy: cy,
        },
      },
      {
        type: "report.resolved",
        payload: {
          communityId: community,
          postId: post,
          commentId: null,
          reporterIds: [bob],
          resolution: "dismissed",
          resolvedBy: cy,
        },
      },
    ]);

    expect(drafts).toEqual<NotificationDraft[]>([
      {
        communityId: community,
        userId: ada,
        actorId: cy,
        type: "report_actioned",
        subjectType: "comment",
        subjectId: comment,
        postId: post,
        preview: null,
      },
      {
        communityId: community,
        userId: bob,
        actorId: cy,
        type: "report_actioned",
        subjectType: "comment",
        subjectId: comment,
        postId: post,
        preview: null,
      },
      {
        communityId: community,
        userId: bob,
        actorId: cy,
        type: "report_dismissed",
        subjectType: "post",
        subjectId: post,
        postId: post,
        preview: null,
      },
    ]);
  });
});
