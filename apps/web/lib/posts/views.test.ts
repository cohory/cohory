import type { Actor } from "@cohory/authz";
import type { CommentView, PostView } from "@cohory/posts";
import { describe, expect, it } from "vitest";

import type { CommunityAccess } from "./permissions";
import { isNewSince, toFeedComments, toFeedPost } from "./views";

const author = { id: "0192f2a4-0000-7000-8000-0000000000aa", name: "Ana", image: null };
const moderatorId = "0192f2a4-0000-7000-8000-0000000000bb";
const actor: Actor = { kind: "user", userId: moderatorId, platformAdmin: false };
const moderator: CommunityAccess = { actor, role: "owner", entitled: true, privacy: "public" };
const deletedAt = new Date("2026-10-18T10:00:00Z");
const document = { type: "doc" as const, content: [] };

const post: PostView = {
  id: "0192f2a4-0000-7000-8000-0000000000cc",
  communityId: "0192f2a4-0000-7000-8000-0000000000dd",
  status: "published",
  author,
  authorRole: null,
  agent: null,
  category: null,
  title: "Gone",
  body: document,
  bodyHtml: "",
  excerpt: "",
  images: [],
  pinnedAt: null,
  scheduledAt: null,
  editedAt: null,
  likeCount: 0,
  commentCount: 0,
  viewerHasLiked: false,
  viewerFollows: false,
  conversation: null,
  lastActivityAt: deletedAt,
  deletion: null,
  createdAt: deletedAt,
  updatedAt: deletedAt,
};

const comment: CommentView = {
  id: "0192f2a4-0000-7000-8000-0000000000ee",
  postId: post.id,
  parentId: null,
  author,
  authorRole: null,
  agent: null,
  body: document,
  bodyHtml: "",
  likeCount: 0,
  viewerHasLiked: false,
  editedAt: null,
  deletion: null,
  createdAt: deletedAt,
  updatedAt: deletedAt,
};

const deletion = { at: deletedAt, by: { id: moderatorId, name: "Mo", image: null } };

describe("feed views of deleted content", () => {
  it("maps a live post with its actions and no deletion", () => {
    const view = toFeedPost(moderator, post);

    expect(view.deletion).toBeNull();
    expect(view.actions).toEqual(["pin", "delete", "report"]);
  });

  it("maps a deleted post with who deleted it and no actions", () => {
    const view = toFeedPost(moderator, { ...post, deletion });

    expect(view.deletion).toEqual({ byName: "Mo", at: "2026-10-18T10:00:00.000Z" });
    expect(view.actions).toEqual([]);
  });

  it("maps a deleted comment without edit or delete", () => {
    const [view] = toFeedComments(moderator, [
      { ...comment, deletion: { at: deletedAt, by: null }, replies: [] },
    ]);

    expect(view?.deletion).toEqual({ byName: null, at: "2026-10-18T10:00:00.000Z" });
    expect(view?.permissions).toEqual({ edit: false, delete: false, report: false });
  });
});

describe("conversation life on feed posts", () => {
  const visit = new Date("2026-10-18T09:00:00Z");
  const later = new Date("2026-10-18T11:00:00Z");
  const viewerId = "0192f2a4-0000-7000-8000-0000000000ff";
  const member: CommunityAccess = {
    actor: { kind: "user", userId: viewerId, platformAdmin: false },
    role: "member",
    entitled: true,
    privacy: "public",
  };

  const since = visit.toISOString();

  it("marks a post new when it had activity after the last visit", () => {
    expect(isNewSince(toFeedPost(member, { ...post, lastActivityAt: later }), since)).toBe(true);
  });

  it("does not mark a post new on a first visit or without new activity", () => {
    expect(isNewSince(toFeedPost(member, { ...post, lastActivityAt: later }), null)).toBe(false);
    expect(isNewSince(toFeedPost(member, { ...post, lastActivityAt: visit }), since)).toBe(false);
  });

  it("does not mark the viewer's own post or a deleted post new", () => {
    const own = { ...post, author: { ...author, id: viewerId }, lastActivityAt: later };
    expect(isNewSince(toFeedPost(member, own), since)).toBe(false);
    const gone = { ...post, lastActivityAt: later, deletion: { at: later, by: null } };
    expect(isNewSince(toFeedPost(member, gone), since)).toBe(false);
  });

  it("maps recent commenters, the last comment time, and the author role", () => {
    const view = toFeedPost(member, {
      ...post,
      authorRole: "owner",
      conversation: { recentCommenters: [author], lastCommentAt: later },
    });

    expect(view.authorRole).toBe("owner");
    expect(view.conversation).toEqual({
      recentCommenters: [{ id: author.id, name: "Ana", avatarUrl: null }],
      lastCommentAt: "2026-10-18T11:00:00.000Z",
    });
  });
});
