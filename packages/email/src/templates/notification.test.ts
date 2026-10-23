import { describe, expect, it } from "vitest";

import { allCopy } from "../test/copy";

import { notificationDigestEmail, notificationEmail } from "./notification";

const links = {
  unsubscribeUrl: "http://localhost:3000/unsubscribe?token=abc.def",
  preferencesUrl: "http://localhost:3000/account/notifications",
};

const reply = {
  name: "Bob",
  subject: "Office hours this week",
  items: [{ sentence: "Ada replied to your comment in Makers.", excerpt: "Tuesday works for me." }],
  cta: { label: "Open the comment", url: "http://localhost:3000/c/makers/posts/p1?a=1&b=2" },
  communityName: "Makers",
  reason: "replies to your comments",
  ...links,
};

describe("notificationEmail", () => {
  const email = notificationEmail(reply);

  it("prefixes the given subject with the community", () => {
    expect(email.subject).toBe("[Makers] Office hours this week");
  });

  it("greets the member, says what happened, and quotes the content", () => {
    expect(email.text).toContain("Hi Bob,");
    expect(email.text).toContain("Ada replied to your comment in Makers.");
    expect(email.text).toContain('"Tuesday works for me."');
    expect(email.html).toContain("Tuesday works for me.");
  });

  it("puts the sentence and the excerpt in the preheader", () => {
    expect(email.html).toContain(
      "Ada replied to your comment in Makers. &quot;Tuesday works for me.&quot;",
    );
  });

  it("uses the label the caller chose for the button", () => {
    expect(email.html).toContain("Open the comment");
    expect(email.html).not.toContain("Open the post");
    expect(email.text).toContain(
      "Open the comment: http://localhost:3000/c/makers/posts/p1?a=1&b=2",
    );
    expect(email.html).toContain('href="http://localhost:3000/c/makers/posts/p1?a=1&amp;b=2"');
  });

  it("greets without a name when none is safe to show", () => {
    const anonymous = notificationEmail({ ...reply, name: null });
    expect(anonymous.text.startsWith("Hi,\n")).toBe(true);
  });

  it("lists every update of a grouped email under a heading", () => {
    const grouped = notificationEmail({
      ...reply,
      heading: '2 updates on "Office hours this week"',
      items: [
        { sentence: "Ada mentioned you in a post in Makers." },
        { sentence: "Ada replied to your comment in Makers.", excerpt: "Tuesday works for me." },
      ],
    });
    expect(grouped.text).toContain('2 updates on "Office hours this week"');
    expect(grouped.text).toContain("Ada mentioned you in a post in Makers.");
    expect(grouped.text).toContain('"Tuesday works for me."');
    expect(grouped.html).toContain("2 updates on &quot;Office hours this week&quot;");
  });

  it("says why the member got the email and links settings and unsubscribe", () => {
    expect(email.text).toContain(
      "You get this email because email for replies to your comments is on.",
    );
    expect(email.text).toContain(`Stop these emails: ${links.unsubscribeUrl}`);
    expect(email.text).toContain(`Change your notification settings: ${links.preferencesUrl}`);
    expect(email.html).toContain(`href="${links.unsubscribeUrl}"`);
    expect(email.html).toContain(`href="${links.preferencesUrl}"`);
  });

  it("names the type in the stop link when the caller asks", () => {
    const mixed = notificationEmail({ ...reply, stopLabel: "Stop emails about mentions" });
    expect(mixed.text).toContain(`Stop emails about mentions: ${links.unsubscribeUrl}`);
  });

  it("escapes markup from names, content, and communities", () => {
    const hostile = notificationEmail({
      ...reply,
      name: "<b>Bob</b>",
      items: [{ sentence: "<img src=x> replied", excerpt: "<script>x</script>" }],
      communityName: "<script>x</script>",
    });

    expect(hostile.html).not.toContain("<img");
    expect(hostile.html).not.toContain("<script>");
    expect(hostile.html).toContain("&lt;script&gt;");
  });

  it("uses no exclamation marks and loads no external assets", () => {
    expect(allCopy(email)).not.toContain("!");
    expect(email.html).not.toMatch(/<img|<link|src=/);
  });
});

describe("notificationDigestEmail", () => {
  const items = [
    {
      text: "Ada mentioned you in a post",
      communityName: "Makers",
      url: "http://localhost:3000/c/makers/posts/p1",
    },
    {
      text: "Cy commented on your post",
      communityName: "Gardeners",
      url: "http://localhost:3000/c/gardeners/posts/p2",
    },
    {
      text: "Bo commented on your post",
      communityName: "Makers",
      url: "http://localhost:3000/c/makers/posts/p3",
    },
  ];
  const email = notificationDigestEmail({
    name: "Bob",
    subject: "Ada mentioned you in a post and 2 more",
    items,
    ...links,
  });

  it("uses the summary subject it is given", () => {
    expect(email.subject).toBe("Ada mentioned you in a post and 2 more");
  });

  it("groups the notifications under a heading per community", () => {
    const makers = email.text.indexOf("Makers\n");
    const gardeners = email.text.indexOf("Gardeners\n");
    expect(makers).toBeGreaterThan(-1);
    expect(gardeners).toBeGreaterThan(makers);
    expect(email.text.indexOf("Bo commented on your post")).toBeLessThan(gardeners);
    expect(email.text).toContain("http://localhost:3000/c/gardeners/posts/p2");
    expect(email.html.match(/<li[ >]/g)).toHaveLength(3);
    expect(email.html.match(/<ul[ >]/g)).toHaveLength(2);
    expect(email.html).toContain('href="http://localhost:3000/c/makers/posts/p1"');
  });

  it("greets without a name when none is safe to show", () => {
    const anonymous = notificationDigestEmail({ name: null, subject: "x", items, ...links });
    expect(anonymous.text.startsWith("Hi,\n")).toBe(true);
  });

  it("explains the daily summary and links settings and unsubscribe", () => {
    expect(email.text).toContain("You get this summary because you chose daily email");
    expect(email.text).toContain(`Stop daily summaries: ${links.unsubscribeUrl}`);
    expect(email.html).toContain(`href="${links.preferencesUrl}"`);
  });

  it("uses no exclamation marks", () => {
    expect(allCopy(email)).not.toContain("!");
  });
});
