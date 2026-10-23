import { describe, expect, it } from "vitest";

import { queuedEmailSchema, renderQueuedEmail } from "../queue";
import { allCopy } from "../test/copy";
import { earlyAccessRequestEmail, type EarlyAccessRequestInput } from "./early-access";

const base: EarlyAccessRequestInput = {
  email: "maya@example.com",
  platform: "Skool",
  members: "51 to 500",
  note: "I run a yoga group.\n\nMost members pay yearly.",
  account: null,
  edition: "cloud",
  instanceUrl: "https://cohory.example.com",
  ipHash: "3f2a9c1b7d4e",
  sentAt: "2026-10-23T09:30:00.000Z",
};

describe("earlyAccessRequestEmail", () => {
  it("tags the subject with the platform and member count and lists every answer", () => {
    const email = earlyAccessRequestEmail(base);

    expect(email.subject).toBe("[Cohory early access] Skool, 51 to 500");
    expect(email.text).toContain("Email: maya@example.com");
    expect(email.text).toContain("Platform today: Skool");
    expect(email.text).toContain("Paying members: 51 to 500");
    expect(email.text).toContain("I run a yoga group.");
    expect(email.text).toContain("Most members pay yearly.");
    expect(email.text).toContain("Account: Not signed in");
    expect(email.text).toContain("Client address hash: 3f2a9c1b7d4e");
    expect(allCopy(email)).not.toContain("!");
  });

  it("names the signed in account and says when nothing else was written", () => {
    const email = earlyAccessRequestEmail({
      ...base,
      note: null,
      account: { id: "0199a1b2-0000-7000-8000-000000000042", email: "maya@studio.example.com" },
    });

    expect(email.text).toContain(
      "Account: 0199a1b2-0000-7000-8000-000000000042 (maya@studio.example.com)",
    );
    expect(email.text).toContain("Anything else: none");
  });

  it("escapes the note in the HTML part", () => {
    const email = earlyAccessRequestEmail({ ...base, note: "Look <script>alert(1)</script>" });

    expect(email.html).not.toContain("<script>");
  });

  it("queues with Reply-To set to the requester and refuses a header in a choice", () => {
    const queued = queuedEmailSchema.parse({
      template: "early-access-request",
      to: "hello@cohory.example.com",
      data: base,
    });

    expect(renderQueuedEmail(queued).headers).toEqual({ "Reply-To": "maya@example.com" });
    expect(
      queuedEmailSchema.safeParse({
        template: "early-access-request",
        to: "hello@cohory.example.com",
        data: { ...base, platform: "Skool\r\nBcc: victim@example.com" },
      }).success,
    ).toBe(false);
  });
});
