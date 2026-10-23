import { describe, expect, it } from "vitest";

import {
  createCommentSchema,
  createPostSchema,
  feedPageSchema,
  mentionSearchSchema,
  pinPostSchema,
  toggleLikeSchema,
  updatePostSchema,
  updateScheduledPostSchema,
} from "./schemas";

const postId = "0192f2a4-5b6c-7d8e-9f01-23456789abcd";
const doc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
};

describe("post action schemas", () => {
  it("accepts a post with a trimmed title and a paragraph", () => {
    const parsed = createPostSchema.parse({ slug: "makers", title: "  Hello  ", document: doc });
    expect(parsed.title).toBe("Hello");
  });

  it("emails members only for a post that goes live now", () => {
    const now = createPostSchema.parse({ slug: "makers", title: null, document: doc });
    expect(now.emailMembers).toBe(false);
    const result = createPostSchema.safeParse({
      slug: "makers",
      title: null,
      document: doc,
      scheduledAt: "2026-11-02T09:00:00.000Z",
      emailMembers: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty document with a plain message", () => {
    const result = createPostSchema.safeParse({
      slug: "makers",
      title: null,
      document: { type: "doc", content: [] },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Write something before posting.");
  });

  it("rejects a title over 120 characters", () => {
    const result = createPostSchema.safeParse({
      slug: "makers",
      title: "x".repeat(121),
      document: doc,
    });
    expect(result.error?.issues[0]?.message).toBe("Use 120 characters or fewer for the title.");
  });

  it.each(["", "Makers", "../etc", "a b"])("rejects the slug %j", (slug) => {
    expect(createPostSchema.safeParse({ slug, title: null, document: doc }).success).toBe(false);
  });

  it("rejects unknown block types and script-like nodes", () => {
    const result = createPostSchema.safeParse({
      slug: "makers",
      title: null,
      document: { type: "doc", content: [{ type: "script", text: "alert(1)" }] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a mention without a user id", () => {
    const result = createPostSchema.safeParse({
      slug: "makers",
      title: null,
      document: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "mention", userId: "x", label: "Ana" }] }],
      },
    });
    expect(result.success).toBe(false);
  });

  it("requires a uuid post id for edits, pins, and comments", () => {
    expect(
      updatePostSchema.safeParse({ slug: "makers", postId: "1", title: null, document: doc })
        .success,
    ).toBe(false);
    expect(pinPostSchema.safeParse({ slug: "makers", postId, pinned: true }).success).toBe(true);
    expect(
      createCommentSchema.safeParse({ slug: "makers", postId, parentId: "nope", document: doc })
        .success,
    ).toBe(false);
  });

  it("accepts likes on posts and comments only", () => {
    const base = { slug: "makers", subjectId: postId, liked: true };
    expect(toggleLikeSchema.safeParse({ ...base, subjectType: "comment" }).success).toBe(true);
    expect(toggleLikeSchema.safeParse({ ...base, subjectType: "event" }).success).toBe(false);
  });

  it("bounds feed cursors and mention queries", () => {
    expect(feedPageSchema.safeParse({ slug: "makers", cursor: "" }).success).toBe(false);
    expect(feedPageSchema.safeParse({ slug: "makers", cursor: "x".repeat(513) }).success).toBe(
      false,
    );
    expect(mentionSearchSchema.safeParse({ slug: "makers", query: "ana.l" }).success).toBe(true);
    expect(mentionSearchSchema.safeParse({ slug: "makers", query: "a%" }).success).toBe(false);
    expect(mentionSearchSchema.safeParse({ slug: "makers", query: "x".repeat(33) }).success).toBe(
      false,
    );
  });
});

describe("scheduled post schemas", () => {
  it("defaults to posting now and accepts an instant with an offset", () => {
    expect(createPostSchema.parse({ slug: "makers", title: null, document: doc }).scheduledAt).toBe(
      null,
    );
    const at = "2026-11-02T09:30:00.000Z";
    expect(
      createPostSchema.parse({ slug: "makers", title: null, document: doc, scheduledAt: at })
        .scheduledAt,
    ).toBe(at);
  });

  it("refuses a local time without an offset", () => {
    const result = createPostSchema.safeParse({
      slug: "makers",
      title: null,
      document: doc,
      scheduledAt: "2026-11-02T09:30",
    });
    expect(result.success).toBe(false);
  });

  it("keeps the category of a scheduled post when the edit leaves it out", () => {
    const parsed = updateScheduledPostSchema.parse({
      slug: "makers",
      postId,
      title: null,
      document: doc,
      scheduledAt: "2026-11-02T09:30:00+01:00",
    });
    expect(parsed.categoryId).toBeUndefined();
    expect(
      updateScheduledPostSchema.parse({
        slug: "makers",
        postId,
        title: null,
        document: doc,
        categoryId: null,
        scheduledAt: "2026-11-02T09:30:00+01:00",
      }).categoryId,
    ).toBeNull();
  });

  it("takes no visit time with a feed page", () => {
    expect(feedPageSchema.parse({ slug: "makers", cursor: "c", since: null })).not.toHaveProperty(
      "since",
    );
  });

  it("needs a time when editing a scheduled post", () => {
    const result = updateScheduledPostSchema.safeParse({
      slug: "makers",
      postId,
      title: null,
      document: doc,
    });
    expect(result.success).toBe(false);
  });
});
