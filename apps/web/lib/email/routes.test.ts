import {
  createMemorySuppressionList,
  createOptOutToken,
  hashEmailAddress,
  signEmailWebhook,
} from "@cohory/email";
import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { describe, expect, it } from "vitest";

import {
  emailRateLimitWait,
  handleEmailWebhookRequest,
  handleOneClickOptOut,
  notificationUnsubscribeRedirect,
  optOutPageRedirect,
} from "./routes";

const secret = "s".repeat(32);
const communityId = "0192a1b2-0000-7000-8000-000000000001";
const now = new Date("2026-10-22T10:00:00.000Z");
const addressHash = hashEmailAddress("invitee@example.com");

describe("notificationUnsubscribeRedirect", () => {
  it("sends a GET on the List-Unsubscribe URL to the confirm page", () => {
    const response = notificationUnsubscribeRedirect(
      new Request(
        "https://cohory.example.com/api/v1/notification-preferences/unsubscribe?token=a.b",
      ),
    );

    expect(response?.status).toBe(303);
    expect(response?.headers.get("location")).toBe("/unsubscribe?token=a.b");
  });

  it("leaves the one click POST and other paths to the API", () => {
    const url = "https://cohory.example.com/api/v1/notification-preferences/unsubscribe?token=a.b";

    expect(notificationUnsubscribeRedirect(new Request(url, { method: "POST" }))).toBeNull();
    expect(
      notificationUnsubscribeRedirect(
        new Request("https://cohory.example.com/api/v1/notification-preferences"),
      ),
    ).toBeNull();
  });
});

describe("community opt out endpoint", () => {
  it("opens the confirm page on GET without changing anything", () => {
    const response = optOutPageRedirect(
      new Request("https://cohory.example.com/api/email-opt-out?token=a.b"),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/email-opt-out?token=a.b");
  });

  it("adds a per community opt out on the one click POST", async () => {
    const list = createMemorySuppressionList();
    const token = createOptOutToken(secret, { addressHash, communityId }, now);

    const response = await handleOneClickOptOut(
      { secret, list, now },
      new Request(`https://cohory.example.com/api/email-opt-out?token=${token}`, {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(await list.suppressionReason({ addressHash, communityId })).toBe("opt_out");
    expect(await list.isSuppressed({ addressHash })).toBe(false);
  });

  it("answers 422 to a forged token", async () => {
    const list = createMemorySuppressionList();
    const token = createOptOutToken("o".repeat(32), { addressHash, communityId }, now);

    const response = await handleOneClickOptOut(
      { secret, list, now },
      new Request(`https://cohory.example.com/api/email-opt-out?token=${token}`, {
        method: "POST",
      }),
    );

    expect(response.status).toBe(422);
    expect(await list.isSuppressed({ addressHash, communityId })).toBe(false);
  });
});

const log = { record: async () => undefined };

describe("handleEmailWebhookRequest", () => {
  const url = "https://cohory.example.com/api/webhooks/email";

  function post(body: string, signature: string | null) {
    const headers = new Headers({ "content-type": "application/json" });
    if (signature) headers.set("cohory-signature", signature);
    return new Request(url, { method: "POST", body, headers });
  }

  it("records a signed bounce", async () => {
    const list = createMemorySuppressionList();
    const body = JSON.stringify({ events: [{ type: "hard_bounce", email: "gone@example.com" }] });

    const response = await handleEmailWebhookRequest(
      { secret, list, log, now, newBatchId: () => "batch-1" },
      post(body, signEmailWebhook(secret, body, now.getTime() / 1000)),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recorded: 1, batchId: "batch-1" });
  });

  it("answers 401 without a valid signature and 404 when no secret is set", async () => {
    const list = createMemorySuppressionList();
    const body = JSON.stringify({ events: [{ type: "hard_bounce", email: "gone@example.com" }] });

    const unsigned = await handleEmailWebhookRequest({ secret, list, log, now }, post(body, null));
    const disabled = await handleEmailWebhookRequest(
      { secret: undefined, list, log, now },
      post(body, signEmailWebhook(secret, body, now.getTime() / 1000)),
    );

    expect(unsigned.status).toBe(401);
    expect(disabled.status).toBe(404);
  });

  it("refuses a body over the size limit", async () => {
    const body = "x".repeat(70 * 1024);

    const response = await handleEmailWebhookRequest(
      { secret, list: createMemorySuppressionList(), log, now },
      post(body, signEmailWebhook(secret, body, now.getTime() / 1000)),
    );

    expect(response.status).toBe(413);
  });
});

describe("public write rate limits", () => {
  function limiter() {
    return createRateLimiter({
      rules: {
        ...rateLimitDefaults,
        emailOptOut: { max: 1, windowSeconds: 600 },
        emailWebhook: { max: 1, windowSeconds: 60 },
      },
    });
  }

  function from(url: string, init: RequestInit = {}) {
    return new Request(url, {
      method: "POST",
      ...init,
      headers: { "x-forwarded-for": "203.0.113.7", ...init.headers },
    });
  }

  it("answers 429 to a second one click opt out from the same address", async () => {
    const list = createMemorySuppressionList();
    const token = createOptOutToken(secret, { addressHash, communityId }, now);
    const url = `https://cohory.example.com/api/email-opt-out?token=${token}`;
    const deps = { secret, list, now, limiter: limiter() };

    const first = await handleOneClickOptOut(deps, from(url));
    const second = await handleOneClickOptOut(deps, from(url));

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("answers 429 to webhook calls over the limit before reading them", async () => {
    const list = createMemorySuppressionList();
    const body = JSON.stringify({ events: [{ type: "hard_bounce", email: "gone@example.com" }] });
    const signature = signEmailWebhook(secret, body, now.getTime() / 1000);
    const deps = { secret, list, log, now, limiter: limiter() };
    const request = () =>
      from("https://cohory.example.com/api/webhooks/email", {
        body,
        headers: { "cohory-signature": signature },
      });

    const first = await handleEmailWebhookRequest(deps, request());
    const second = await handleEmailWebhookRequest(deps, request());

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });

  it("reports the wait for the opt out page once the address is over the limit", () => {
    const shared = limiter();
    const headers = new Headers({ "x-forwarded-for": "203.0.113.8" });

    expect(emailRateLimitWait(shared, "emailOptOut", headers)).toBeNull();
    expect(emailRateLimitWait(shared, "emailOptOut", headers)).toBeGreaterThan(0);
  });
});
