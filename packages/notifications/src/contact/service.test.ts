import type { QueuedEmail } from "@cohory/email";
import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { describe, expect, it } from "vitest";

import { createFormToken } from "../public-form/form-token";
import {
  createContactService,
  type ContactAccount,
  type ContactLogEntry,
  type ContactServiceDeps,
} from "./service";

const secret = "test-secret-for-contact-forms-0123456789";
const start = new Date("2026-10-23T09:00:00.000Z");

function setup(overrides: Partial<ContactServiceDeps> = {}) {
  let clock = start.getTime();
  const sent: QueuedEmail[] = [];
  const logs: ContactLogEntry[] = [];
  const limiter = createRateLimiter({ rules: rateLimitDefaults, now: () => clock });
  const service = createContactService({
    outbox: {
      send: async (email) => {
        sent.push(email);
      },
    },
    limiter,
    secret,
    contactEmail: "hello@operator.example.com",
    edition: "community",
    instanceUrl: "https://club.example.com",
    now: () => new Date(clock),
    log: (entry) => logs.push(entry),
    ...overrides,
  });
  return {
    service,
    sent,
    logs,
    advance(seconds: number) {
      clock += seconds * 1000;
    },
    token(secondsAgo = 10) {
      return createFormToken(
        secret,
        "cohory.contact.form-token.v1",
        new Date(clock - secondsAgo * 1000),
      );
    },
  };
}

function form(token: string, overrides: Record<string, unknown> = {}) {
  return {
    name: "Lena Test",
    email: "lena@example.com",
    topic: "Help with my community",
    message: "How do I move my members over from another platform?",
    link: "https://club.example.com/c/painters",
    website: "",
    token,
    ...overrides,
  };
}

const account: ContactAccount = {
  id: "0199a1b2-0000-7000-8000-000000000001",
  name: "Ada Account",
  email: "ada@example.com",
  emailVerified: false,
  createdAt: new Date("2026-02-01T10:00:00.000Z"),
  communities: [
    { name: "Painters", slug: "painters", role: "owner" },
    { name: "Runners", slug: "runners", role: "member" },
  ],
};

function contactData(email: QueuedEmail | undefined) {
  if (email?.template !== "contact-message") {
    throw new Error("expected a contact message");
  }
  return email.data;
}

describe("contact service", () => {
  it("sends one email to the contact address with the message, topic, and link when signed out", async () => {
    const { service, sent, logs, token } = setup();

    const result = await service.submit({ form: form(token()), ip: "203.0.113.7", account: null });

    expect(result).toEqual({ status: "sent" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("hello@operator.example.com");
    const data = contactData(sent[0]);
    expect(data).toMatchObject({
      topic: "Help with my community",
      name: "Lena Test",
      email: "lena@example.com",
      link: "https://club.example.com/c/painters",
      account: null,
      edition: "community",
      instanceUrl: "https://club.example.com",
    });
    expect(data.ipHash).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(data)).not.toContain("203.0.113.7");
    expect(logs).toEqual([{ outcome: "sent", signedIn: false, links: 0 }]);
  });

  it("uses the account's name and email and adds the account block when signed in", async () => {
    const { service, sent, token } = setup();

    await service.submit({
      form: form(token(), { name: "Someone Else", email: "spoof@example.com", link: "" }),
      ip: "203.0.113.7",
      account,
    });

    const data = contactData(sent[0]);
    expect(data.name).toBe("Ada Account");
    expect(data.email).toBe("ada@example.com");
    expect(data.link).toBeNull();
    expect(data.account).toEqual({
      id: account.id,
      name: "Ada Account",
      email: "ada@example.com",
      emailVerified: false,
      createdAt: "2026-02-01T10:00:00.000Z",
      communities: [
        { name: "Painters", slug: "painters", role: "owner" },
        { name: "Runners", slug: "runners", role: "member" },
      ],
      moreCommunities: 0,
    });
  });

  it("lists at most 20 communities and counts the rest", async () => {
    const { service, sent, token } = setup();
    const communities = Array.from({ length: 25 }, (_, index) => ({
      name: `Club ${index}`,
      slug: `club-${index}`,
      role: "member",
    }));

    await service.submit({
      form: form(token()),
      ip: "203.0.113.7",
      account: { ...account, communities },
    });

    const data = contactData(sent[0]);
    expect(data.account?.communities).toHaveLength(20);
    expect(data.account?.moreCommunities).toBe(5);
  });

  it("drops a honeypot hit silently and reports success", async () => {
    const { service, sent, logs, token } = setup();

    const result = await service.submit({
      form: form(token(), { website: "https://spam.example.com" }),
      ip: "203.0.113.7",
      account: null,
    });

    expect(result).toEqual({ status: "sent" });
    expect(sent).toHaveLength(0);
    expect(logs[0]?.outcome).toBe("honeypot");
  });

  it("rejects a form sent less than 3 seconds after it was shown", async () => {
    const { service, sent, token } = setup();

    const result = await service.submit({ form: form(token(1)), ip: "203.0.113.7", account: null });

    expect(result).toMatchObject({ status: "rejected", code: "too_fast" });
    expect(sent).toHaveLength(0);
  });

  it("rejects a form older than 2 hours", async () => {
    const { service, sent, token } = setup();

    const result = await service.submit({
      form: form(token(2 * 60 * 60 + 1)),
      ip: "203.0.113.7",
      account: null,
    });

    expect(result).toMatchObject({ status: "rejected", code: "expired" });
    expect(sent).toHaveLength(0);
  });

  it("rejects a missing or forged form token", async () => {
    const { service, token } = setup();
    const [issuedAt] = token().split(".");

    expect(
      await service.submit({ form: form(""), ip: "203.0.113.7", account: null }),
    ).toMatchObject({ code: "bad_token" });
    expect(
      await service.submit({ form: form(`${issuedAt}.forged`), ip: "203.0.113.7", account: null }),
    ).toMatchObject({ code: "bad_token" });
  });

  it("allows at most 3 links in the message when signed out and 10 when signed in", async () => {
    const { service, sent, token } = setup();
    const four =
      "See https://a.example.com www.b.example.com http://c.example.com https://d.example.com";

    const signedOut = await service.submit({
      form: form(token(), { message: four }),
      ip: "203.0.113.7",
      account: null,
    });
    const signedIn = await service.submit({
      form: form(token(), { message: four }),
      ip: "203.0.113.8",
      account,
    });

    expect(signedOut).toEqual({
      status: "rejected",
      code: "too_many_links",
      message: "Use at most 3 links in the message.",
    });
    expect(signedIn).toEqual({ status: "sent" });
    expect(sent).toHaveLength(1);
  });

  it("limits a client address to 5 messages an hour and 20 a day", async () => {
    const { service, sent, advance, token } = setup();
    const send = () => service.submit({ form: form(token()), ip: "203.0.113.7", account: null });

    for (let index = 0; index < 5; index += 1) {
      expect(await send()).toEqual({ status: "sent" });
    }
    expect(await send()).toMatchObject({
      code: "rate_limited",
      message: "You sent several messages already. Try again later.",
    });
    expect(
      await service.submit({ form: form(token()), ip: "203.0.113.99", account: null }),
    ).toEqual({ status: "sent" });

    for (let hour = 0; hour < 3; hour += 1) {
      advance(3601);
      for (let index = 0; index < 5; index += 1) {
        expect(await send()).toEqual({ status: "sent" });
      }
    }
    advance(3601);
    expect(await send()).toMatchObject({ code: "rate_limited" });
    expect(sent).toHaveLength(21);
  });

  it("limits a signed in account to 10 messages a day across addresses", async () => {
    const { service, token } = setup();

    for (let index = 0; index < 10; index += 1) {
      expect(
        await service.submit({ form: form(token()), ip: `198.51.100.${index}`, account }),
      ).toEqual({ status: "sent" });
    }
    expect(
      await service.submit({ form: form(token()), ip: "198.51.100.200", account }),
    ).toMatchObject({ code: "rate_limited" });
  });

  it("refuses a name that would inject email headers", async () => {
    const { service, sent, token } = setup();

    const result = await service.submit({
      form: form(token(), { name: "Lena\r\nBcc: victim@example.com" }),
      ip: "203.0.113.7",
      account: null,
    });

    expect(result).toMatchObject({ status: "rejected", code: "invalid" });
    expect(sent).toHaveLength(0);
  });

  it("refuses an email address with a line break", async () => {
    const { service, token } = setup();

    expect(
      await service.submit({
        form: form(token(), { email: "lena@example.com\nBcc: victim@example.com" }),
        ip: "203.0.113.7",
        account: null,
      }),
    ).toMatchObject({ code: "invalid", message: "Enter a valid email address." });
  });

  it("checks the message length and the topic", async () => {
    const { service, token } = setup();

    expect(
      await service.submit({
        form: form(token(), { message: "Too short" }),
        ip: "1.1.1.1",
        account: null,
      }),
    ).toMatchObject({ code: "invalid", message: "Write at least 10 characters." });
    expect(
      await service.submit({
        form: form(token(), { message: "x".repeat(5001) }),
        ip: "1.1.1.1",
        account: null,
      }),
    ).toMatchObject({ code: "invalid", message: "Keep the message under 5000 characters." });
    expect(
      await service.submit({
        form: form(token(), { topic: "Sales" }),
        ip: "1.1.1.1",
        account: null,
      }),
    ).toMatchObject({ code: "invalid", message: "Choose a topic." });
  });

  it("refuses every message and sends nothing when no contact address is set", async () => {
    const { service, sent, token } = setup({ contactEmail: null });

    expect(service.available).toBe(false);
    expect(
      await service.submit({ form: form(token()), ip: "203.0.113.7", account: null }),
    ).toMatchObject({ code: "unavailable" });
    expect(sent).toHaveLength(0);
  });

  it("never logs the message or the email address", async () => {
    const { service, logs, token } = setup();

    await service.submit({ form: form(token()), ip: "203.0.113.7", account: null });
    await service.submit({ form: form(token(1)), ip: "203.0.113.7", account: null });

    const logged = JSON.stringify(logs);
    expect(logged).not.toContain("lena@example.com");
    expect(logged).not.toContain("move my members");
    expect(logged).not.toContain("203.0.113.7");
  });
});
