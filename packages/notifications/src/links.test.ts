import { describe, expect, it } from "vitest";

import { notificationPath } from "./links";

describe("notificationPath", () => {
  it("opens the post for post and comment notifications", () => {
    expect(
      notificationPath({
        type: "reply",
        subjectType: "comment",
        communitySlug: "makers",
        postId: "p1",
      }),
    ).toBe("/c/makers/posts/p1");
  });

  it("sends staff to the Requests tab and requesters to the community or About page", () => {
    const base = {
      subjectType: "membership_request" as const,
      communitySlug: "makers",
      postId: null,
    };
    expect(notificationPath({ ...base, type: "join_request" })).toBe(
      "/c/makers/manage/inbox?tab=requests",
    );
    expect(notificationPath({ ...base, type: "join_request_approved" })).toBe("/c/makers");
    expect(notificationPath({ ...base, type: "join_request_declined" })).toBe("/c/makers/about");
    expect(
      notificationPath({ ...base, type: "approval_request", subjectType: "approval_request" }),
    ).toBe("/c/makers/manage/inbox?tab=approvals");
    expect(
      notificationPath({ ...base, type: "agent_access", subjectType: "course_delegation" }),
    ).toBe("/account/agents?community=makers");
  });
  it("opens the membership page for a change to a paid membership", () => {
    expect(
      notificationPath({
        type: "paid_membership_changed",
        subjectType: "community",
        communitySlug: "makers",
        postId: null,
      }),
    ).toBe("/c/makers/membership");
  });

  it("sends the owner to the reviews on the About page", () => {
    expect(
      notificationPath({
        type: "review_created",
        subjectType: "review",
        communitySlug: "makers",
        postId: null,
      }),
    ).toBe("/c/makers/about#reviews");
  });

  it("opens Manage, Payments after an ownership transfer", () => {
    expect(
      notificationPath({
        type: "ownership_transferred",
        subjectType: "community",
        communitySlug: "makers",
        postId: null,
      }),
    ).toBe("/c/makers/manage/payments");
  });

  it("opens Manage, Payments when a member disputes a payment", () => {
    expect(
      notificationPath({
        type: "payment_disputed",
        subjectType: "community",
        communitySlug: "makers",
        postId: null,
      }),
    ).toBe("/c/makers/manage/payments");
  });

  it.each([
    { type: "member_joined", path: "/c/makers/manage/people" },
    { type: "paid_member_joined", path: "/c/makers/manage/people" },
    { type: "paid_member_canceled", path: "/c/makers/manage/people" },
    { type: "member_payment_failed", path: "/c/makers/manage/people" },
    { type: "report_created", path: "/c/makers/manage/inbox?tab=reports" },
    { type: "event_created", path: "/c/makers/calendar" },
    { type: "event_reminder", path: "/c/makers/calendar" },
  ] as const)("sends $type to $path", ({ type, path }) => {
    expect(
      notificationPath({ type, subjectType: "community", communitySlug: "makers", postId: null }),
    ).toBe(path);
  });

  it("opens the liked post", () => {
    expect(
      notificationPath({
        type: "like_on_post",
        subjectType: "post",
        communitySlug: "makers",
        postId: "p1",
      }),
    ).toBe("/c/makers/posts/p1");
  });

  it("sends a token expiry notice to the person's tokens", () => {
    expect(
      notificationPath({
        type: "token_expiring",
        subjectType: "api_token",
        communitySlug: "makers",
        postId: null,
      }),
    ).toBe("/account/api-tokens");
  });

  it.each(["agent_token", "community"] as const)(
    "sends an agent token expiry notice with subject %s to the person's agents in that community",
    (subjectType) => {
      expect(
        notificationPath({
          type: "token_expiring",
          subjectType,
          communitySlug: "makers",
          postId: null,
        }),
      ).toBe("/account/agents?community=makers");
    },
  );
});
