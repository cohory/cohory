import { describe, expect, it } from "vitest";

import { ownershipTransferredEmail } from "./ownership-transferred";

describe("ownershipTransferredEmail", () => {
  it("tells the new owner what changed and where to choose a Stripe account", () => {
    const email = ownershipTransferredEmail({
      communityName: "Makers",
      previousOwnerName: "Olga",
      paymentsUrl: "https://cohory.test/c/makers/manage/payments",
    });

    expect(email.subject).toBe("[Makers] You are now the owner");
    expect(email.text).toContain("Olga made you the owner of Makers.");
    expect(email.text).toContain(
      "If Makers sells memberships, new checkouts are paused until you choose which Stripe account takes payments. Members who already pay keep their access.",
    );
    expect(email.text).toContain("https://cohory.test/c/makers/manage/payments");
    expect(email.html).toContain("Choose a Stripe account");
  });
});
