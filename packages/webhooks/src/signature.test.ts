import { describe, expect, it } from "vitest";

import {
  generateWebhookSecret,
  signWebhook,
  verifyWebhook,
  webhookHeaders,
  WebhookVerificationError,
} from "./signature";

const vector = {
  secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  timestamp: 1614265330,
  body: '{"test": 2432232314}',
  signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
};

describe("signWebhook", () => {
  it("matches the Standard Webhooks reference vector", () => {
    expect(signWebhook(vector)).toBe(vector.signature);
  });

  it("changes when any signed part changes", () => {
    expect(signWebhook({ ...vector, id: "msg_other" })).not.toBe(vector.signature);
    expect(signWebhook({ ...vector, timestamp: vector.timestamp + 1 })).not.toBe(vector.signature);
    expect(signWebhook({ ...vector, body: '{"test": 2432232315}' })).not.toBe(vector.signature);
  });
});

describe("webhookHeaders", () => {
  it("returns the three Standard Webhooks headers", () => {
    expect(webhookHeaders(vector)).toEqual({
      "webhook-id": vector.id,
      "webhook-timestamp": "1614265330",
      "webhook-signature": vector.signature,
    });
  });

  it("signs with the previous secret too while a rolled secret overlaps", () => {
    const previous = "whsec_cHJldmlvdXMgc2VjcmV0IGZvciB0ZXN0cw==";
    const headers = webhookHeaders(vector, [previous]);
    expect(headers["webhook-signature"]).toBe(
      `${vector.signature} ${signWebhook({ ...vector, secret: previous })}`,
    );
    const now = new Date(vector.timestamp * 1000);
    for (const secret of [vector.secret, previous]) {
      expect(() => verifyWebhook({ secret, body: vector.body, headers, now })).not.toThrow();
    }
  });
});

describe("verifyWebhook", () => {
  const now = new Date(vector.timestamp * 1000 + 60_000);

  it("accepts the reference vector within the tolerance", () => {
    expect(() =>
      verifyWebhook({
        secret: vector.secret,
        body: vector.body,
        headers: webhookHeaders(vector),
        now,
      }),
    ).not.toThrow();
  });

  it("accepts one valid signature among several", () => {
    const headers = {
      ...webhookHeaders(vector),
      "webhook-signature": `v1,bm90IGl0 ${vector.signature}`,
    };
    expect(() =>
      verifyWebhook({ secret: vector.secret, body: vector.body, headers, now }),
    ).not.toThrow();
  });

  it("rejects a wrong signature, a stale timestamp, and missing headers", () => {
    const headers = webhookHeaders(vector);
    expect(() =>
      verifyWebhook({ secret: vector.secret, body: `${vector.body} `, headers, now }),
    ).toThrow(WebhookVerificationError);
    expect(() =>
      verifyWebhook({
        secret: vector.secret,
        body: vector.body,
        headers,
        now: new Date(vector.timestamp * 1000 + 10 * 60_000),
      }),
    ).toThrow(WebhookVerificationError);
    expect(() =>
      verifyWebhook({ secret: vector.secret, body: vector.body, headers: {}, now }),
    ).toThrow(WebhookVerificationError);
  });
});

describe("generateWebhookSecret", () => {
  it("creates distinct whsec_ secrets of 24 random bytes", () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9+/]{32}$/);
    expect(a).not.toBe(b);
    expect(Buffer.from(a.slice(6), "base64")).toHaveLength(24);
  });
});
