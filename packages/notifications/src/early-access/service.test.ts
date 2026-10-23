import type { QueuedEmail } from "@cohory/email";
import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { describe, expect, it } from "vitest";

import { createFormToken } from "../public-form/form-token";
import {
  createEarlyAccessService,
  type EarlyAccessLogEntry,
  type EarlyAccessServiceDeps,
} from "./service";

const secret = "test-secret-for-early-access-0123456789";
const start = new Date("2026-10-23T09:00:00.000Z");
const accountId = "0199a1b2-0000-7000-8000-000000000042";

function setup(overrides: Partial<EarlyAccessServiceDeps> = {}) {
  let clock = start.getTime();
  const sent: QueuedEmail[] = [];
  const logs: EarlyAccessLogEntry[] = [];
  const limiter = createRateLimiter({ rules: rateLimitDefaults, now: () => clock });
  const service = createEarlyAccessService({
    outbox: {
      send: async (email) => {
        sent.push(email);
      },
    },
    limiter,
    secret,
    contactEmail: "hello@cohory.example.com",
    edition: "cloud",
    instanceUrl: "https://cohory.example.com",
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
        "cohory.early-access.form-token.v1",
        new Date(clock - secondsAgo * 1000),
      );
    },
  };
}

function form(token: string, overrides: Record<string, unknown> = {}) {
  return {
    email: "maya@example.com",
    platform: "Skool",
    members: "51 to 500",
    note: "I run a yoga group with 120 paying members.",
    website: "",
    token,
    ...overrides,
  };
}

function requestData(email: QueuedEmail | undefined) {
  if (email?.template !== "early-access-request") {
    throw new Error("expected an early access request");
  }
  return email.data;
}

describe("early access service", () => {
  it("emails the answers to the contact address with the requester as the reply address", async () => {
    const { service, sent, logs, token } = setup();

    const result = await service.submit({ form: form(token()), ip: "203.0.113.7", account: null });

    expect(result).toEqual({ status: "accepted" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("hello@cohory.example.com");
    const data = requestData(sent[0]);
    expect(data).toMatchObject({
      email: "maya@example.com",
      platform: "Skool",
      members: "51 to 500",
      note: "I run a yoga group with 120 paying members.",
      account: null,
      edition: "cloud",
      instanceUrl: "https://cohory.example.com",
    });
    expect(data.ipHash).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(data)).not.toContain("203.0.113.7");
    expect(logs).toEqual([{ outcome: "sent", signedIn: false }]);
  });

  it("adds the signed in account id and keeps the address the requester typed", async () => {
    const { service, sent, token } = setup();

    await service.submit({
      form: form(token(), { email: "work@studio.example.com", note: "  " }),
      ip: "203.0.113.7",
      account: { id: accountId, email: "maya@example.com" },
    });

    const data = requestData(sent[0]);
    expect(data.email).toBe("work@studio.example.com");
    expect(data.note).toBeNull();
    expect(data.account).toEqual({ id: accountId, email: "maya@example.com" });
  });

  it("drops a honeypot hit and answers as if it was sent", async () => {
    const { service, sent, logs, token } = setup();

    const result = await service.submit({
      form: form(token(), { website: "https://spam.example.com" }),
      ip: "203.0.113.7",
      account: null,
    });

    expect(result).toEqual({ status: "accepted" });
    expect(sent).toHaveLength(0);
    expect(logs).toEqual([{ outcome: "honeypot", signedIn: false }]);
  });

  it("drops a form sent within 3 seconds, an expired form, and a forged token without saying so", async () => {
    const { service, sent, logs, token } = setup();
    const [issuedAt] = token().split(".");

    for (const value of [token(1), token(2 * 60 * 60 + 1), `${issuedAt}.forged`, ""]) {
      expect(await service.submit({ form: form(value), ip: "203.0.113.7", account: null })).toEqual(
        { status: "accepted" },
      );
    }

    expect(sent).toHaveLength(0);
    expect(logs.map((entry) => entry.outcome)).toEqual([
      "too_fast",
      "expired",
      "bad_token",
      "bad_token",
    ]);
  });

  it("refuses a token issued for the contact form", async () => {
    const { service, sent, logs } = setup();
    const contactToken = createFormToken(
      secret,
      "cohory.contact.form-token.v1",
      new Date(start.getTime() - 10_000),
    );

    await service.submit({ form: form(contactToken), ip: "203.0.113.7", account: null });

    expect(sent).toHaveLength(0);
    expect(logs[0]?.outcome).toBe("bad_token");
  });

  it("limits a client address to 5 requests an hour and answers the same once over", async () => {
    const { service, sent, logs, token } = setup();
    const send = () => service.submit({ form: form(token()), ip: "203.0.113.7", account: null });

    for (let index = 0; index < 5; index += 1) {
      expect(await send()).toEqual({ status: "accepted" });
    }
    expect(await send()).toEqual({ status: "accepted" });
    expect(
      await service.submit({ form: form(token()), ip: "203.0.113.99", account: null }),
    ).toEqual({ status: "accepted" });

    expect(sent).toHaveLength(6);
    expect(logs.at(-2)?.outcome).toBe("rate_limited");
  });

  it("limits a signed in account to 10 requests a day across addresses", async () => {
    const { service, sent, logs, token } = setup();
    const account = { id: accountId, email: "maya@example.com" };

    for (let index = 0; index < 11; index += 1) {
      await service.submit({ form: form(token()), ip: `198.51.100.${index}`, account });
    }

    expect(sent).toHaveLength(10);
    expect(logs.at(-1)?.outcome).toBe("rate_limited");
  });

  it("keeps its own budget apart from the contact form", async () => {
    const limiter = createRateLimiter({ rules: rateLimitDefaults, now: () => start.getTime() });
    for (let index = 0; index < 5; index += 1) {
      limiter.consume("contactIpHour", "contact:ip:203.0.113.7");
    }
    const { service, sent, token } = setup({ limiter });

    await service.submit({ form: form(token()), ip: "203.0.113.7", account: null });

    expect(sent).toHaveLength(1);
  });

  it("names the field when the platform or the member count is not one of the choices", async () => {
    const { service, sent, logs, token } = setup();

    expect(
      await service.submit({
        form: form(token(), { platform: "Patreon" }),
        ip: "203.0.113.7",
        account: null,
      }),
    ).toEqual({
      status: "invalid",
      field: "platform",
      message: "Choose the platform you use today.",
    });
    expect(
      await service.submit({
        form: form(token(), { members: "Thousands" }),
        ip: "203.0.113.7",
        account: null,
      }),
    ).toEqual({
      status: "invalid",
      field: "members",
      message: "Choose how many paying members you have.",
    });
    expect(
      await service.submit({
        form: form(token(), { note: "x".repeat(1001) }),
        ip: "203.0.113.7",
        account: null,
      }),
    ).toEqual({ status: "invalid", field: "note", message: "Keep it under 1000 characters." });
    expect(sent).toHaveLength(0);
    expect(logs.map((entry) => entry.outcome)).toEqual(["invalid", "invalid", "invalid"]);
  });

  it("refuses an email address that would inject a mail header", async () => {
    const { service, sent, token } = setup();

    for (const email of [
      "maya@example.com\r\nBcc: victim@example.com",
      "maya@example.com\nBcc: victim@example.com",
      "not an address",
    ]) {
      expect(
        await service.submit({ form: form(token(), { email }), ip: "203.0.113.7", account: null }),
      ).toEqual({ status: "invalid", field: "email", message: "Enter a valid email address." });
    }
    expect(sent).toHaveLength(0);
  });

  it("is unavailable and sends nothing without a contact address", async () => {
    const { service, sent, logs, token } = setup({ contactEmail: null });

    expect(service.available).toBe(false);
    expect(await service.submit({ form: form(token()), ip: "203.0.113.7", account: null })).toEqual(
      { status: "unavailable" },
    );
    expect(sent).toHaveLength(0);
    expect(logs).toEqual([{ outcome: "unavailable", signedIn: false }]);
  });

  it("is unavailable on the Community Edition", async () => {
    const { service, sent, token } = setup({ edition: "community" });

    expect(service.available).toBe(false);
    expect(await service.submit({ form: form(token()), ip: "203.0.113.7", account: null })).toEqual(
      { status: "unavailable" },
    );
    expect(sent).toHaveLength(0);
  });

  it("never logs the answers, the address, or the client address", async () => {
    const { service, logs, token } = setup();

    await service.submit({ form: form(token()), ip: "203.0.113.7", account: null });
    await service.submit({
      form: form(token(), { website: "x" }),
      ip: "203.0.113.7",
      account: null,
    });

    const logged = JSON.stringify(logs);
    expect(logged).not.toContain("maya@example.com");
    expect(logged).not.toContain("yoga");
    expect(logged).not.toContain("Skool");
    expect(logged).not.toContain("203.0.113.7");
  });
});
