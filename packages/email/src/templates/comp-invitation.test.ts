import { describe, expect, it } from "vitest";

import { compInvitationEmail } from "./comp-invitation";

describe("compInvitationEmail", () => {
  const url = "http://localhost:3000/sign-in?next=%2Fc%2Fdesign%2Fmembership";

  it("names the community, the address, and the end date, and asks the person to accept", () => {
    const mail = compInvitationEmail({
      communityName: "Design <Club>",
      email: "ada@example.test",
      url,
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    });

    expect(mail.subject).toBe("[Design <Club>] You're offered free access");
    expect(mail.text).toContain("until December 1, 2026");
    expect(mail.text).toContain("ada@example.test");
    expect(mail.text).toContain("Nothing changes until you accept.");
    expect(mail.text).toContain(url);
    expect(mail.text).not.toContain("!");
    expect(mail.html).toContain("Design &lt;Club&gt;");
  });

  it("leaves out the end date when the access has none", () => {
    const mail = compInvitationEmail({
      communityName: "Design",
      email: "ada@example.test",
      url,
      expiresAt: null,
    });
    expect(mail.text).toContain("free access to its paid community. You don't pay anything.");
  });

  it("offers a link to stop emails about the community", () => {
    const optOutUrl = "https://example.test/email-opt-out?token=t";
    const mail = compInvitationEmail({
      communityName: "Design",
      email: "ada@example.com",
      url,
      expiresAt: null,
      optOutUrl,
    });

    expect(mail.text).toContain(`Don't email me about Design: ${optOutUrl}`);
  });
});
