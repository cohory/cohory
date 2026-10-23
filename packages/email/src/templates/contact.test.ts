import { describe, expect, it } from "vitest";

import { queuedEmailSchema, renderQueuedEmail } from "../queue";
import { allCopy } from "../test/copy";
import { contactMessageEmail, type ContactMessageInput } from "./contact";

const base: ContactMessageInput = {
  topic: "Billing",
  name: "Ada Lovelace",
  email: "ada@example.com",
  message: "My card was charged twice.\n\nCan you check?",
  link: "https://cohory.example.com/c/club",
  account: null,
  edition: "cloud",
  instanceUrl: "https://cohory.example.com",
  ipHash: "3f2a9c1b7d4e",
  sentAt: "2026-10-23T09:30:00.000Z",
};

const account = {
  id: "0199a1b2-0000-7000-8000-000000000001",
  name: "Ada Lovelace",
  email: "ada@example.com",
  emailVerified: true,
  createdAt: "2026-01-05T08:00:00.000Z",
  communities: [
    { name: "Club", slug: "club", role: "owner" },
    { name: "Painters", slug: "painters", role: "member" },
  ],
  moreCommunities: 0,
};

describe("contactMessageEmail", () => {
  it("gives the operator the topic, sender, link, and message, and says when nobody is signed in", () => {
    const email = contactMessageEmail(base);

    expect(email.subject).toBe(
      "[Cohory contact] Billing: My card was charged twice. Can you check?",
    );
    expect(email.text).toContain("From: Ada Lovelace <ada@example.com> (not signed in)");
    expect(email.text).toContain("Page or community: https://cohory.example.com/c/club");
    expect(email.text).toContain("My card was charged twice.");
    expect(email.text).toContain("Can you check?");
    expect(email.text).toContain("Account: Not signed in");
    expect(email.text).toContain("Edition: cloud");
    expect(email.text).toContain("Client address hash: 3f2a9c1b7d4e");
    expect(allCopy(email)).not.toContain("!");
  });

  it("adds the account block with owned and joined communities when signed in", () => {
    const email = contactMessageEmail({ ...base, account });

    expect(email.text).toContain("From: Ada Lovelace <ada@example.com>\n");
    expect(email.text).toContain(`User id: ${account.id}`);
    expect(email.text).toContain("Account email: ada@example.com (verified)");
    expect(email.text).toContain("Account created: 2026-01-05");
    expect(email.text).toContain("Owns: Club (club)");
    expect(email.text).toContain("Member of: Painters (painters, member)");
    expect(email.text).not.toContain("Not signed in");
  });

  it("keeps the subject on one line and cuts the excerpt at 60 characters", () => {
    const email = contactMessageEmail({
      ...base,
      message: `Line one\r\nBcc: x@example.com ${"y".repeat(80)}`,
    });

    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject).toBe(
      `[Cohory contact] Billing: Line one Bcc: x@example.com ${"y".repeat(32)}`,
    );
  });

  it("escapes the message in the HTML part", () => {
    const email = contactMessageEmail({ ...base, message: "Look <script>alert(1)</script>" });

    expect(email.html).not.toContain("<script>");
  });
});

describe("queued contact message", () => {
  it("lets the operator reply to the sender directly", () => {
    const message = renderQueuedEmail({
      template: "contact-message",
      to: "operator@example.com",
      data: { ...base, account },
    });

    expect(message.headers).toEqual({ "Reply-To": "ada@example.com" });
  });

  it("refuses a sender name that would break a header", () => {
    const parsed = queuedEmailSchema.safeParse({
      template: "contact-message",
      to: "operator@example.com",
      data: { ...base, name: "Ada\r\nBcc: victim@example.com" },
    });

    expect(parsed.success).toBe(false);
  });
});
