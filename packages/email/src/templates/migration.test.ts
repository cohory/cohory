import { describe, expect, it } from "vitest";

import { communityMovedEmail, memberAddedEmail, memberInvitedEmail } from "./migration";

const url = "https://example.test/forgot-password?email=ada%40example.test";

describe("migration emails", () => {
  it("tells moved members where to choose a password", () => {
    const email = communityMovedEmail({ name: "Ada", communityName: "Makers", url });

    expect(email.subject).toBe("[Makers] The community has moved");
    expect(email.text).toContain(url);
    expect(email.html).toContain("Choose a password");
  });

  it("starts every community subject with the community name", () => {
    expect(
      memberAddedEmail({ name: "A", communityName: "Makers", url, hasPassword: true }).subject,
    ).toBe("[Makers] You were added to the community");
    expect(memberInvitedEmail({ name: "A", communityName: "Makers", url }).subject).toBe(
      "[Makers] You are invited to join",
    );
  });

  it("links an added member to the community when they already have a password", () => {
    const email = memberAddedEmail({
      name: "Ada",
      communityName: "Makers",
      url,
      hasPassword: true,
    });

    expect(email.text).toContain("You are now a member of Makers. Open it here:");
    expect(email.html).toContain("Open Makers");
  });

  it("asks an added member without a password to choose one", () => {
    const email = memberAddedEmail({
      name: "Ada",
      communityName: "Makers",
      url,
      hasPassword: false,
    });

    expect(email.text).toContain("choose a password");
  });

  it("escapes markup in names and uses no exclamation marks", () => {
    const email = memberInvitedEmail({ name: "<b>x</b>", communityName: "<i>M</i>", url });

    expect(email.html).not.toContain("<b>");
    expect(email.html).not.toContain("<i>");
    for (const content of [
      email,
      communityMovedEmail({ name: "A", communityName: "M", url }),
      memberAddedEmail({ name: "A", communityName: "M", url, hasPassword: false }),
    ]) {
      expect(content.text).not.toContain("!");
    }
  });

  it("leaves unsafe names out of greetings and the inviter line", () => {
    const hostile = '=HYPERLINK("http://x")';
    const emails = [
      communityMovedEmail({ name: hostile, communityName: "Makers", url }),
      memberAddedEmail({ name: hostile, communityName: "Makers", url, hasPassword: true }),
      memberInvitedEmail({
        name: hostile,
        communityName: "Makers",
        url,
        firstContact: {
          inviterName: "ada@example.com",
          origin: { kind: "list" },
          optOutUrl: "https://example.test/email-opt-out?token=t",
        },
      }),
    ];

    for (const email of emails) {
      expect(email.text.startsWith("Hi,\n")).toBe(true);
      expect(email.text).not.toContain("HYPERLINK");
    }
    expect(emails[2]?.text).toContain("Someone invited you because");
    expect(emails[2]?.text).not.toContain("ada@example.com");
  });

  describe("moved and invited people", () => {
    const move = { inviterName: "Grace", origin: { kind: "platform", name: "Skool" } } as const;

    it("names the creator, the old platform, and only what moved", () => {
      const email = communityMovedEmail({
        name: "Ada",
        communityName: "Makers",
        url,
        move,
        moved: ["posts", "comments"],
      });

      expect(email.text).toContain("Grace moved Makers from Skool to Cohory.");
      expect(email.text).toContain("Your posts and comments are already there.");
      expect(email.text).not.toContain("courses");
      expect(email.text).toContain("The link works once and expires in 7 days.");
    });

    it("leaves out the moved list when nothing of the person moved", () => {
      const email = communityMovedEmail({ name: "Ada", communityName: "Makers", url, move });

      expect(email.text).not.toContain("already there");
    });

    it("tells an invited person who moved the community and why to join", () => {
      const email = memberInvitedEmail({
        name: "Ada",
        communityName: "Makers",
        url,
        move,
        moved: ["posts"],
      });

      expect(email.text).toContain("Grace moved Makers from Skool to Cohory.");
      expect(email.text).toContain("Join with your own account to get back in:");
      expect(email.text).toContain("Your posts are already there.");
    });

    it("says who invites from a member list", () => {
      const email = memberInvitedEmail({
        name: "Ada",
        communityName: "Makers",
        url,
        move: { inviterName: "Grace", origin: { kind: "list" } },
      });

      expect(email.text).toContain("Grace invited you to join Makers on Cohory.");
    });

    it("adds the creator's note as plain text without links", () => {
      const email = memberInvitedEmail({
        name: "Ada",
        communityName: "Makers",
        url,
        move,
        note: "See you on Thursday <b>live</b>, details at https://evil.example and www.evil.example",
      });

      expect(email.text).toContain(
        'A note from Grace: "See you on Thursday <b>live</b>, details at and"',
      );
      expect(email.text).not.toContain("evil.example");
      expect(email.html).not.toContain("<b>live</b>");
    });

    it("removes bare domains and paths from the note too", () => {
      const email = memberInvitedEmail({
        name: "Ada",
        communityName: "Makers",
        url,
        move,
        note: "Log in at evil.com/login or sub.example.co, e.g. by Thursday, version 2.5 is out",
      });

      expect(email.text).toContain(
        'A note from Grace: "Log in at or , e.g. by Thursday, version 2.5 is out"',
      );
      expect(email.text).not.toMatch(/evil\.com|sub\.example\.co/);
    });
  });

  describe("first contact opt out", () => {
    const optOutUrl = "https://example.test/email-opt-out?token=t";

    it("says who invited the person from which list and offers to stop emails", () => {
      const email = memberInvitedEmail({
        name: "Ada",
        communityName: "Makers",
        url,
        firstContact: { inviterName: "Grace", origin: { kind: "list" }, optOutUrl },
      });

      expect(email.text).toContain(
        "Grace invited you because your address is on their member list for Makers.",
      );
      expect(email.text).toContain(`Don't email me about Makers: ${optOutUrl}`);
      expect(email.html).toContain("Don&#39;t email me about Makers");
    });

    it("names the platform a moved community came from", () => {
      const email = communityMovedEmail({
        name: "Ada",
        communityName: "Makers",
        url,
        firstContact: {
          inviterName: "Grace",
          origin: { kind: "platform", name: "Skool" },
          optOutUrl,
        },
      });

      expect(email.text).toContain(
        "Grace invited you because you were a member of Makers on Skool.",
      );
      expect(email.text).toContain(optOutUrl);
    });

    it("says the community moved when the archive came from another Cohory", () => {
      const email = memberInvitedEmail({
        name: "Ada",
        communityName: "Makers",
        url,
        firstContact: { inviterName: "Grace", origin: { kind: "archive" }, optOutUrl },
      });

      expect(email.text).toContain(
        "Grace invited you because you were a member of Makers before it moved.",
      );
    });
  });
});
