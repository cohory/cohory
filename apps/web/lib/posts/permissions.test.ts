import type { Actor, CommunityRole } from "@cohory/authz";
import { describe, expect, it } from "vitest";

import {
  canCreateComment,
  canCreatePost,
  canEmailMembers,
  canFollow,
  canLike,
  commentPermissions,
  postActionIds,
  postPermissions,
  type CommunityAccess,
} from "./permissions";

const author = "0192f2a4-0000-7000-8000-0000000000aa";
const other = "0192f2a4-0000-7000-8000-0000000000bb";

function access(role: CommunityRole | null, userId = other, entitled = true): CommunityAccess {
  const actor: Actor = { kind: "user", userId, platformAdmin: false };
  return { actor, role, entitled, privacy: "public" };
}

const guest: CommunityAccess = {
  actor: { kind: "guest" },
  role: null,
  entitled: false,
  privacy: "public",
};

describe("post actions from the policy", () => {
  it("gives the author edit and delete but not pin", () => {
    const permissions = postPermissions(access("member", author), author);
    expect(postActionIds(permissions, false)).toEqual(["edit", "delete"]);
  });

  it("lets another member only report the post", () => {
    expect(postActionIds(postPermissions(access("member"), author), false)).toEqual(["report"]);
  });

  it("lets a moderator delete or report but not edit or pin someone else's post", () => {
    expect(postActionIds(postPermissions(access("moderator"), author), false)).toEqual([
      "delete",
      "report",
    ]);
  });

  it.each(["admin", "owner"] as const)("lets an %s pin, delete, and report", (role) => {
    const permissions = postPermissions(access(role), author);
    expect(postActionIds(permissions, false)).toEqual(["pin", "delete", "report"]);
    expect(postActionIds(permissions, true)).toEqual(["unpin", "delete", "report"]);
  });

  it("gives an owner who wrote the post every action", () => {
    expect(postActionIds(postPermissions(access("owner", author), author), true)).toEqual([
      "edit",
      "unpin",
      "delete",
    ]);
  });

  it("gives guests and signed in non members nothing", () => {
    expect(postActionIds(postPermissions(guest, author), false)).toEqual([]);
    expect(postActionIds(postPermissions(access(null), author), false)).toEqual([]);
  });
});

describe("comment actions and creation from the policy", () => {
  it("lets the author edit and delete, and staff only delete", () => {
    expect(commentPermissions(access("member", author), author)).toEqual({
      edit: true,
      delete: true,
      report: false,
    });
    expect(commentPermissions(access("moderator"), author)).toEqual({
      edit: false,
      delete: true,
      report: true,
    });
    expect(commentPermissions(access("member"), author)).toEqual({
      edit: false,
      delete: false,
      report: true,
    });
    expect(commentPermissions(access(null), author)).toEqual({
      edit: false,
      delete: false,
      report: false,
    });
  });

  it("lets members post and comment but not guests or non members", () => {
    expect(canCreatePost(access("member"))).toBe(true);
    expect(canCreateComment(access("member"))).toBe(true);
    expect(canCreatePost(guest)).toBe(false);
    expect(canCreateComment(access(null))).toBe(false);
  });

  it("hides posting and liking from a member whose paid access ended", () => {
    const ended = access("member", other, false);
    expect(canCreatePost(ended)).toBe(false);
    expect(canCreateComment(ended)).toBe(false);
    expect(canLike(ended)).toBe(false);
  });
});

describe("following and member email from the policy", () => {
  it.each(["owner", "admin"] as const)("offers member email to an %s", (role) => {
    expect(canEmailMembers(access(role))).toBe(true);
  });

  it.each(["moderator", "member", null] as const)("hides member email from %s", (role) => {
    expect(canEmailMembers(access(role))).toBe(false);
    expect(canEmailMembers(guest)).toBe(false);
  });

  it("lets members follow posts but not guests or non members", () => {
    expect(canFollow(access("member"))).toBe(true);
    expect(canFollow(access(null))).toBe(false);
    expect(canFollow(guest)).toBe(false);
  });
});
