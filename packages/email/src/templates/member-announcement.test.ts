import { describe, expect, it } from "vitest";

import { memberAnnouncementEmail } from "./member-announcement";

const base = {
  communityName: "Design Club",
  authorName: "Riza",
  postUrl: "https://community.example.com/c/design-club/posts/1",
  optOutUrl: "https://community.example.com/email-opt-out?token=t",
};

describe("memberAnnouncementEmail", () => {
  it("uses the post title as the subject and the start of the post as the preheader", () => {
    const email = memberAnnouncementEmail({
      ...base,
      title: "Live call on Friday",
      bodyText: `We meet at 17:00.\n\n${"Bring questions. ".repeat(10)}`,
    });

    expect(email.subject).toBe("[Design Club] Live call on Friday");
    expect(email.template).toBe("member-announcement");
    expect(email.text).toContain("Riza posted in Design Club:");
    expect(email.text).toContain("We meet at 17:00.");
    expect(email.text).toContain("Read and reply");
    expect(email.html).toContain(base.postUrl);
    expect(email.html).toContain(base.optOutUrl);
    expect(email.html).toContain("We meet at 17:00. Bring questions.");
  });

  it("links only the community opt out, which the job honours, from the footer", () => {
    const email = memberAnnouncementEmail({ ...base, title: "News", bodyText: "Hi" });

    expect(email.text).toContain("Stop emails from Design Club");
    expect(email.text).not.toContain("Manage notifications");
    expect(email.html).not.toContain("/account/notifications");
  });

  it("falls back to the start of the post when there is no title", () => {
    const email = memberAnnouncementEmail({ ...base, title: null, bodyText: "Short note" });

    expect(email.subject).toBe("[Design Club] Short note");
  });

  it("escapes the post text in the html part", () => {
    const email = memberAnnouncementEmail({ ...base, title: "<b>x</b>", bodyText: "<script>" });

    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<b>x</b>");
  });
});
