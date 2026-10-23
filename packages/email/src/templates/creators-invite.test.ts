import { describe, expect, it, vi } from "vitest";

import { creatorsInviteEmail, type CreatorsInviteInput } from "./creators-invite";

vi.stubEnv("INSTANCE_NAME", "");

const input: CreatorsInviteInput = {
  name: "Ada",
  communityName: "Cohory Creators",
  inviterName: "Riza",
  url: "https://cohory.test/join/abc",
  expiresAt: new Date("2026-11-22T09:00:00.000Z"),
};

describe("creatorsInviteEmail", () => {
  it("explains what the community is for and links to join it", () => {
    const mail = creatorsInviteEmail(input);

    expect(mail.template).toBe("creators-invite");
    expect(mail.subject).toBe("[Cohory Creators] You're invited to join Cohory Creators");
    expect(mail.text).toContain("Hi Ada,");
    expect(mail.text).toContain(
      "Riza would like you to join Cohory Creators, a private community for people who run communities on Cohory.",
    );
    expect(mail.text).toContain("The link works once, until 22 November 2026.");
    expect(mail.text).toContain("https://cohory.test/join/abc");
    expect(mail.text).toContain("because you created a community on Cohory");
    expect(mail.text).not.toContain("!");
  });

  it("does not repeat what the community is for", () => {
    const mail = creatorsInviteEmail(input);
    expect(mail.text.match(/what to build next/g)).toHaveLength(1);
  });

  it("speaks as we when the inviter's name is unsafe to show", () => {
    const mail = creatorsInviteEmail({ ...input, inviterName: "www.phish.example" });
    expect(mail.text).toContain("We would like you to join Cohory Creators");
  });

  it("offers a link to stop emails about the community", () => {
    const optOutUrl = "https://cohory.test/email-opt-out?token=t";
    const mail = creatorsInviteEmail({ ...input, optOutUrl });
    expect(mail.text).toContain(`Don't email me about Cohory Creators: ${optOutUrl}`);
  });

  it("escapes the community name in HTML", () => {
    const mail = creatorsInviteEmail({ ...input, communityName: "Makers <b>" });
    expect(mail.html).toContain("Makers &lt;b&gt;");
  });
});
