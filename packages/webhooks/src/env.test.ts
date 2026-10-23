import { keyIdOf } from "@cohory/payments/crypto";
import { describe, expect, it } from "vitest";

import { openWebhookSecret, sealWebhookSecret, webhookKeyFromEnv } from "./env";

const authSecret = "a-long-auth-secret-of-at-least-32-characters";

describe("webhookKeyFromEnv", () => {
  it("uses WEBHOOKS_ENCRYPTION_KEY when it is set", () => {
    const key = Buffer.alloc(32, 7);
    const ring = webhookKeyFromEnv({
      WEBHOOKS_ENCRYPTION_KEY: key.toString("base64"),
      BETTER_AUTH_SECRET: authSecret,
    });
    expect(ring.currentId).toBe(keyIdOf(key));
    expect(ring.keys.size).toBe(2);
  });

  it("seals with the first of WEBHOOKS_ENCRYPTION_KEYS and opens values sealed with the older keys", () => {
    const next = Buffer.alloc(32, 8);
    const old = webhookKeyFromEnv({ BETTER_AUTH_SECRET: authSecret });
    const sealed = sealWebhookSecret("whsec_old", old, "endpoint-a");
    const ring = webhookKeyFromEnv({
      WEBHOOKS_ENCRYPTION_KEYS: next.toString("base64"),
      BETTER_AUTH_SECRET: authSecret,
    });
    expect(ring.currentId).toBe(keyIdOf(next));
    expect(openWebhookSecret(sealed, ring, "endpoint-a")).toBe("whsec_old");
  });

  it("derives a stable 32 byte key from BETTER_AUTH_SECRET otherwise", () => {
    const a = webhookKeyFromEnv({ BETTER_AUTH_SECRET: authSecret });
    const b = webhookKeyFromEnv({ BETTER_AUTH_SECRET: authSecret });
    expect(a.keys.get(a.currentId)).toHaveLength(32);
    expect(a.currentId).toBe(b.currentId);
    expect(a.currentId).not.toBe(
      webhookKeyFromEnv({ BETTER_AUTH_SECRET: `${authSecret}x` }).currentId,
    );
  });

  it("refuses a key of the wrong length and a missing secret", () => {
    expect(() =>
      webhookKeyFromEnv({ WEBHOOKS_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }),
    ).toThrow();
    expect(() => webhookKeyFromEnv({})).toThrow();
  });
});

describe("sealWebhookSecret", () => {
  it("round trips only for the same endpoint", () => {
    const key = Buffer.alloc(32, 3);
    const sealed = sealWebhookSecret("whsec_abc", key, "endpoint-a");
    expect(sealed).not.toContain("whsec_abc");
    expect(openWebhookSecret(sealed, key, "endpoint-a")).toBe("whsec_abc");
    expect(() => openWebhookSecret(sealed, key, "endpoint-b")).toThrow();
  });
});
