import { describe, expect, it } from "vitest";

import { hashEmailAddress, type EmailLogEntry } from "./log";
import { createMemorySuppressionList } from "./suppression";
import { emailWebhookSecretFromEnv, handleEmailWebhook, signEmailWebhook } from "./webhook";

const secret = "w".repeat(32);
const now = new Date("2026-10-22T10:00:00.000Z");
const nowSeconds = now.getTime() / 1000;
const communityId = "0192a1b2-0000-7000-8000-000000000001";

const batchId = "0192a1b2-0000-7000-8000-0000000000b1";

function memoryLog() {
  const entries: EmailLogEntry[] = [];
  return { entries, record: async (entry: EmailLogEntry) => void entries.push(entry) };
}

function signed(payload: unknown, at = nowSeconds) {
  const body = JSON.stringify(payload);
  return { body, signature: signEmailWebhook(secret, body, at) };
}

describe("handleEmailWebhook", () => {
  it("records bounces and complaints as webhook suppressions", async () => {
    const list = createMemorySuppressionList();
    const request = signed({
      events: [
        { type: "hard_bounce", email: "Gone@Example.com" },
        { type: "complaint", addressHash: hashEmailAddress("angry@example.com"), communityId },
      ],
    });

    const log = memoryLog();

    const result = await handleEmailWebhook({
      secret,
      list,
      log,
      now,
      newBatchId: () => batchId,
      ...request,
    });

    expect(result).toEqual({ kind: "recorded", count: 2, batchId });
    expect(
      await list.suppressionReason({ addressHash: hashEmailAddress("gone@example.com") }),
    ).toBe("hard_bounce");
    expect(
      await list.isSuppressed({ addressHash: hashEmailAddress("angry@example.com"), communityId }),
    ).toBe(true);
    expect(await list.isSuppressed({ addressHash: hashEmailAddress("angry@example.com") })).toBe(
      false,
    );
  });

  it("is off when no secret is configured", async () => {
    const result = await handleEmailWebhook({
      secret: undefined,
      list: createMemorySuppressionList(),
      log: memoryLog(),
      ...signed({ events: [] }),
    });

    expect(result).toEqual({ kind: "disabled" });
  });

  it("rejects a missing, forged, or stale signature and records nothing", async () => {
    const list = createMemorySuppressionList();
    const payload = { events: [{ type: "hard_bounce", email: "gone@example.com" }] };
    const body = JSON.stringify(payload);

    const results = await Promise.all([
      handleEmailWebhook({ secret, list, log: memoryLog(), now, body, signature: null }),
      handleEmailWebhook({
        secret,
        list,
        log: memoryLog(),
        now,
        body,
        signature: signEmailWebhook("x".repeat(32), body, nowSeconds),
      }),
      handleEmailWebhook({
        secret,
        list,
        log: memoryLog(),
        now,
        ...signed(payload, nowSeconds - 600),
      }),
      handleEmailWebhook({
        secret,
        list,
        log: memoryLog(),
        now,
        body: body.replace("gone", "other"),
        signature: signEmailWebhook(secret, body, nowSeconds),
      }),
    ]);

    expect(results.map((result) => result.kind)).toEqual([
      "unsigned",
      "unsigned",
      "unsigned",
      "unsigned",
    ]);
    expect(await list.isSuppressed({ addressHash: hashEmailAddress("gone@example.com") })).toBe(
      false,
    );
  });

  it("rejects an event without an address or with an unknown type", async () => {
    const list = createMemorySuppressionList();

    const missing = await handleEmailWebhook({
      secret,
      list,
      log: memoryLog(),
      now,
      ...signed({ events: [{ type: "hard_bounce" }] }),
    });
    const unknown = await handleEmailWebhook({
      secret,
      list,
      log: memoryLog(),
      now,
      ...signed({ events: [{ type: "soft_bounce", email: "a@example.com" }] }),
    });

    expect(missing.kind).toBe("invalid");
    expect(unknown.kind).toBe("invalid");
  });
});

describe("handleEmailWebhook audit trail", () => {
  it("writes one audit row per event, tied together by the batch id", async () => {
    const log = memoryLog();

    await handleEmailWebhook({
      secret,
      list: createMemorySuppressionList(),
      log,
      now,
      newBatchId: () => batchId,
      ...signed({
        events: [
          { type: "hard_bounce", email: "gone@example.com" },
          { type: "complaint", email: "angry@example.com" },
        ],
      }),
    });

    expect(log.entries).toEqual([
      {
        template: "suppression-webhook",
        recipientHash: hashEmailAddress("gone@example.com"),
        status: "suppressed",
        errorCode: `batch=${batchId};n=2`,
      },
      {
        template: "suppression-webhook",
        recipientHash: hashEmailAddress("angry@example.com"),
        status: "suppressed",
        errorCode: `batch=${batchId};n=2`,
      },
    ]);
  });

  it("writes nothing for a rejected call", async () => {
    const log = memoryLog();
    const body = JSON.stringify({ events: [{ type: "hard_bounce", email: "gone@example.com" }] });

    await handleEmailWebhook({
      secret,
      list: createMemorySuppressionList(),
      log,
      now,
      body,
      signature: null,
    });

    expect(log.entries).toEqual([]);
  });
});

describe("emailWebhookSecretFromEnv", () => {
  it("treats an empty secret as unset and refuses a short one", () => {
    expect(emailWebhookSecretFromEnv({ EMAIL_WEBHOOK_SECRET: "" })).toBeUndefined();
    expect(() => emailWebhookSecretFromEnv({ EMAIL_WEBHOOK_SECRET: "short" })).toThrow();
  });
});
