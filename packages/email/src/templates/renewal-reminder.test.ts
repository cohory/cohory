import { describe, expect, it } from "vitest";

import { renewalReminderEmail } from "./renewal-reminder";

const input = {
  communityName: "Makers",
  amountMinor: 29000,
  currency: "usd",
  renewsAt: new Date("2026-11-18T10:00:00.000Z"),
  membershipUrl: "https://cohory.test/c/makers/membership",
};

describe("renewalReminderEmail", () => {
  it("names the date and the amount for the coming year", () => {
    const email = renewalReminderEmail(input);

    expect(email.subject).toBe("[Makers] Your membership renews on November 18, 2026");
    expect(email.text).toContain(
      "Your yearly membership in Makers renews on November 18, 2026. We will charge $290.00 for one more year.",
    );
    expect(email.text).toContain("Manage billing: https://cohory.test/c/makers/membership");
  });

  it("escapes the community name in HTML", () => {
    const email = renewalReminderEmail({ ...input, communityName: "<b>Makers</b>" });

    expect(email.html).not.toContain("<b>Makers</b>");
  });
});
