import { describe, expect, it } from "vitest";

import { composeNotificationEmail, digestSubject, emailExcerpt, type EmailNotice } from "./content";

function notice(overrides: Partial<EmailNotice> & Pick<EmailNotice, "type">): EmailNotice {
  return {
    subjectType: "post",
    actorName: "Ada",
    detail: null,
    excerpt: null,
    ...overrides,
  };
}

describe("emailExcerpt", () => {
  it("flattens whitespace and cuts long text at 200 characters", () => {
    expect(emailExcerpt("Line one\n\n  line two")).toBe("Line one line two");
    const long = emailExcerpt("word ".repeat(100));
    expect(long?.length).toBeLessThanOrEqual(200);
    expect(long?.endsWith("...")).toBe(true);
  });

  it("returns nothing for empty text", () => {
    expect(emailExcerpt(" \n ")).toBeNull();
    expect(emailExcerpt(undefined)).toBeNull();
  });
});

describe("composeNotificationEmail", () => {
  const community = "Review13 Lab";

  it.each([
    ["mention", "comment", "Ada mentioned you in a comment in Review13 Lab.", "Open the comment"],
    ["reply", "comment", "Ada replied to your comment in Review13 Lab.", "Open the comment"],
    [
      "comment_on_post",
      "comment",
      "Ada commented on your post in Review13 Lab.",
      "Open the comment",
    ],
    ["mention", "post", "Ada mentioned you in a post in Review13 Lab.", "Open the post"],
    ["join_request", "membership_request", "Ada asked to join Review13 Lab.", "Review the request"],
    [
      "join_request_approved",
      "membership_request",
      "Your request to join Review13 Lab was approved.",
      "Open Review13 Lab",
    ],
    [
      "join_request_declined",
      "membership_request",
      "Your request to join Review13 Lab was declined.",
      "Open Review13 Lab",
    ],
    [
      "approval_request",
      "approval_request",
      "An agent of Ada asks for your approval in Review13 Lab.",
      "Review the approval",
    ],
    ["review_created", "review", "Ada left a review of Review13 Lab.", "Read the review"],
    ["agent_access", "course_delegation", null, "Open your agents"],
    ["member_joined", "community", "Ada joined Review13 Lab.", "Open People"],
    ["report_created", "report", null, "Review the reports"],
    ["event_reminder", "event", null, "Open the calendar"],
  ] as const)(
    "writes %s on a %s as one sentence with its own button",
    (type, subjectType, sentence, cta) => {
      const email = composeNotificationEmail({
        notices: [notice({ type, subjectType })],
        communityName: community,
        postTitle: null,
      });
      if (sentence) {
        expect(email.items[0]?.sentence).toBe(sentence);
      }
      expect(email.ctaLabel).toBe(cta);
    },
  );

  it("titles a post email with the post title so every email about it threads", () => {
    const email = composeNotificationEmail({
      notices: [notice({ type: "reply", subjectType: "comment", excerpt: "Tuesday works." })],
      communityName: community,
      postTitle: "Office hours this week",
    });
    expect(email.subject).toBe("Office hours this week");
    expect(email.heading).toBeUndefined();
    expect(email.items).toEqual([
      { sentence: "Ada replied to your comment in Review13 Lab.", excerpt: "Tuesday works." },
    ]);
  });

  it("gives a post without a known title a stable subject per post so mail apps thread it", () => {
    const postId = "019a0000-0000-7000-8000-00000000c0de";
    const single = composeNotificationEmail({
      notices: [notice({ type: "reply", subjectType: "comment" })],
      communityName: community,
      postTitle: null,
      postId,
    });
    const merged = composeNotificationEmail({
      notices: [notice({ type: "mention" }), notice({ type: "reply", subjectType: "comment" })],
      communityName: community,
      postTitle: null,
      postId,
    });
    expect(single.subject).toBe("New activity on a post (c0de)");
    expect(merged.subject).toBe(single.subject);
    expect(merged.heading).toBe("2 updates on a post");
  });

  it("keeps a notice without a post titled by what happened", () => {
    const email = composeNotificationEmail({
      notices: [notice({ type: "join_request_approved", subjectType: "membership_request" })],
      communityName: community,
      postTitle: null,
      postId: null,
    });
    expect(email.subject).toBe("Your request to join was approved");
  });

  it("strips line breaks and direction marks from a post title before it reaches the subject", () => {
    const email = composeNotificationEmail({
      notices: [notice({ type: "mention" }), notice({ type: "reply", subjectType: "comment" })],
      communityName: community,
      postTitle: "Office\r\nBcc: x@evil.example\u202E hours",
      postId: "p1",
    });
    expect(email.subject).toBe("Office Bcc: x@evil.example hours");
    expect(email.heading).toBe('2 updates on "Office Bcc: x@evil.example hours"');
  });

  it("merges updates on one post into one email with a count", () => {
    const email = composeNotificationEmail({
      notices: [
        notice({ type: "mention", subjectType: "post" }),
        notice({ type: "reply", subjectType: "comment", actorName: "Cy" }),
      ],
      communityName: community,
      postTitle: "Email review test",
    });
    expect(email.subject).toBe("Email review test");
    expect(email.heading).toBe('2 updates on "Email review test"');
    expect(email.ctaLabel).toBe("Open the post");
    expect(email.reason).toBe("mentions and replies to your comments");
    expect(email.scope).toBe("mention");
    expect(email.stopLabel).toBe("Stop emails about mentions");
  });

  it("merges join requests into one email per community", () => {
    const email = composeNotificationEmail({
      notices: [
        notice({ type: "join_request", subjectType: "membership_request", excerpt: "I teach" }),
        notice({ type: "join_request", subjectType: "membership_request", actorName: "Bo" }),
        notice({ type: "join_request", subjectType: "membership_request", actorName: "Cy" }),
      ],
      communityName: community,
      postTitle: null,
    });
    expect(email.subject).toBe("3 people asked to join");
    expect(email.heading).toBe("3 people asked to join Review13 Lab.");
    expect(email.ctaLabel).toBe("Review the requests");
    expect(email.items[0]).toEqual({
      sentence: "Ada asked to join Review13 Lab.",
      excerpt: "I teach",
    });
    expect(email.stopLabel).toBeUndefined();
  });

  it("never puts an unsafe actor name into the subject or sentence", () => {
    const email = composeNotificationEmail({
      notices: [
        notice({
          type: "join_request",
          subjectType: "membership_request",
          actorName: '=HYPERLINK("http://x")',
        }),
      ],
      communityName: community,
      postTitle: null,
    });
    expect(email.subject).toBe("Someone asked to join");
    expect(email.items[0]?.sentence).toBe("Someone asked to join Review13 Lab.");
  });
});

describe("digestSubject", () => {
  it("names the first person and counts the others when every item is the same kind", () => {
    expect(
      digestSubject([
        notice({ type: "comment_on_post", actorName: "Rev Member13" }),
        notice({ type: "comment_on_post", actorName: "Cy" }),
        notice({ type: "comment_on_post", actorName: "Bo" }),
        notice({ type: "comment_on_post", actorName: "Cy" }),
      ]),
    ).toBe("Rev Member13 and 2 others commented on your posts");
    expect(
      digestSubject([
        notice({ type: "comment_on_post", actorName: "Cy" }),
        notice({ type: "comment_on_post", actorName: "Cy" }),
      ]),
    ).toBe("Cy commented on your posts");
  });

  it("uses the first line and a count for a mix of kinds", () => {
    expect(
      digestSubject([
        notice({ type: "member_joined", subjectType: "community" }),
        notice({ type: "comment_on_post" }),
        notice({ type: "mention" }),
      ]),
    ).toBe("Ada joined the community and 2 more");
  });

  it("uses the line itself for a single item", () => {
    expect(digestSubject([notice({ type: "comment_on_post", actorName: "Cy" })])).toBe(
      "Cy commented on your post",
    );
  });
});
