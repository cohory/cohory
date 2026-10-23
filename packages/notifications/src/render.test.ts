import { describe, expect, it } from "vitest";

import { renderNotificationText } from "./render";

describe("renderNotificationText", () => {
  it.each([
    { type: "mention", subjectType: "post", text: "Ada mentioned you in a post" },
    { type: "mention", subjectType: "comment", text: "Ada mentioned you in a comment" },
    { type: "reply", subjectType: "comment", text: "Ada replied to your comment" },
    { type: "comment_on_post", subjectType: "comment", text: "Ada commented on your post" },
    { type: "like_on_post", subjectType: "post", text: "Ada liked your post" },
    { type: "like_on_comment", subjectType: "comment", text: "Ada liked your comment" },
  ] as const)("renders $type on a $subjectType", ({ type, subjectType, text }) => {
    expect(renderNotificationText({ type, subjectType, actorName: "Ada" })).toBe(text);
  });

  it("uses the stored detail for approval requests and a neutral line without it", () => {
    const base = {
      type: "approval_request",
      subjectType: "approval_request",
      actorName: "Ada",
    } as const;
    expect(
      renderNotificationText({ ...base, detail: "Helper asks to remove Sam from the community" }),
    ).toBe("Helper asks to remove Sam from the community");
    expect(renderNotificationText(base)).toBe("An agent of Ada asks for your approval");
  });

  it.each([
    { type: "member_joined", subjectType: "community", text: "Ada joined the community" },
    { type: "paid_member_joined", subjectType: "community", text: "Ada joined as a paying member" },
    {
      type: "token_expiring",
      subjectType: "api_token",
      text: "One of your tokens expires in 7 days",
    },
    {
      type: "comment_on_followed_post",
      subjectType: "comment",
      text: "Ada commented on a post you follow",
    },
  ] as const)("renders a plain line for $type", ({ type, subjectType, text }) => {
    expect(renderNotificationText({ type, subjectType, actorName: "Ada" })).toBe(text);
  });

  it("falls back to a neutral name when the actor has no name", () => {
    expect(renderNotificationText({ type: "reply", subjectType: "comment", actorName: "  " })).toBe(
      "Someone replied to your comment",
    );
  });
  it("tells the owner someone reviewed the community", () => {
    expect(
      renderNotificationText({ type: "review_created", subjectType: "review", actorName: "Ada" }),
    ).toBe("Ada left a review of your community");
  });

  it("uses the stored detail for community notices about paid memberships and ownership", () => {
    const paid = {
      type: "paid_membership_changed",
      subjectType: "community",
      actorName: "Ada",
    } as const;
    const transfer = { ...paid, type: "ownership_transferred" } as const;

    expect(renderNotificationText({ ...paid, detail: "Your membership ends on 30 November" })).toBe(
      "Your membership ends on 30 November",
    );
    expect(renderNotificationText(paid)).toBe("Something changed in your paid membership");
    expect(renderNotificationText(transfer)).toBe("Ada transferred ownership of the community");
  });

  it("uses the stored detail for a payment dispute and falls back to a plain notice", () => {
    const disputed = {
      type: "payment_disputed",
      subjectType: "community",
      actorName: "Ada",
    } as const;

    expect(
      renderNotificationText({ ...disputed, detail: "A member disputed a payment of $49.00" }),
    ).toBe("A member disputed a payment of $49.00");
    expect(renderNotificationText(disputed)).toBe("A member disputed a payment");
  });

  it("groups likes on one subject into one line", () => {
    const base = { type: "like_on_post", subjectType: "post", actorName: "Jamie Lee" } as const;
    expect(renderNotificationText({ ...base, detail: "1" })).toBe(
      "Jamie Lee and 1 other liked your post",
    );
    expect(renderNotificationText({ ...base, detail: "2" })).toBe(
      "Jamie Lee and 2 others liked your post",
    );
    expect(
      renderNotificationText({
        type: "like_on_comment",
        subjectType: "comment",
        actorName: "Jamie Lee",
        detail: "3",
      }),
    ).toBe("Jamie Lee and 3 others liked your comment");
    expect(renderNotificationText({ ...base, detail: "0" })).toBe("Jamie Lee liked your post");
  });

  it("counts the reports filed within the hour", () => {
    const base = { type: "report_created", subjectType: "report", actorName: "Ada" } as const;
    expect(renderNotificationText(base)).toBe("A new report is waiting for review");
    expect(renderNotificationText({ ...base, detail: "1" })).toBe(
      "A new report is waiting for review",
    );
    expect(renderNotificationText({ ...base, detail: "4" })).toBe(
      "4 new reports are waiting for review",
    );
  });

  it("tells the owner about money events with the stored detail", () => {
    const base = { subjectType: "community", actorName: "Sam" } as const;
    expect(renderNotificationText({ ...base, type: "paid_member_canceled" })).toBe(
      "Sam canceled their paid membership",
    );
    expect(
      renderNotificationText({
        ...base,
        type: "paid_member_canceled",
        detail: "Sam canceled. Access ends on 30 November 2026.",
      }),
    ).toBe("Sam canceled. Access ends on 30 November 2026.");
    expect(renderNotificationText({ ...base, type: "member_payment_failed" })).toBe(
      "A payment from Sam failed",
    );
  });

  it("groups new members into one line", () => {
    const base = { type: "member_joined", subjectType: "community", actorName: "Sam" } as const;
    expect(renderNotificationText({ ...base, detail: "2" })).toBe(
      "Sam and 2 others joined the community",
    );
  });
});
