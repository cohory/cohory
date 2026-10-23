import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { WebhookSignatureError } from "../../stripe-gateway";
import { signStandardWebhook, verifyStandardWebhook } from "./webhook";

const at = new Date("2026-10-19T10:00:00.000Z");
const body = JSON.stringify({ type: "order.paid", data: { id: "order_1" } });
const standardSecret = `whsec_${Buffer.from("a standard webhooks key").toString("base64")}`;

function headersOf(signed: Record<string, string>) {
  return {
    id: signed["webhook-id"] ?? null,
    timestamp: signed["webhook-timestamp"] ?? null,
    signature: signed["webhook-signature"] ?? null,
  };
}

describe("Polar webhook signatures", () => {
  it("accepts a Standard Webhooks signature made with the decoded secret", () => {
    const signed = signStandardWebhook(standardSecret, "msg_1", at, body);
    expect(verifyStandardWebhook(body, headersOf(signed), standardSecret, at)).toBe("msg_1");
  });

  it("accepts the older Polar scheme keyed with the whole secret string", () => {
    const secret = "whsec_older_polar_secret_value";
    const timestamp = String(Math.floor(at.getTime() / 1000));
    const mac = createHmac("sha256", Buffer.from(secret, "utf8"))
      .update(`msg_2.${timestamp}.${body}`)
      .digest("base64");
    expect(
      verifyStandardWebhook(
        body,
        { id: "msg_2", timestamp, signature: `v1,bogus v1,${mac}` },
        secret,
        at,
      ),
    ).toBe("msg_2");
  });

  it("refuses a tampered body, another secret, and missing headers", () => {
    const signed = headersOf(signStandardWebhook(standardSecret, "msg_3", at, body));
    expect(() => verifyStandardWebhook(`${body} `, signed, standardSecret, at)).toThrow(
      WebhookSignatureError,
    );
    expect(() => verifyStandardWebhook(body, signed, "whsec_b3RoZXI=", at)).toThrow(
      WebhookSignatureError,
    );
    expect(() =>
      verifyStandardWebhook(body, { ...signed, signature: null }, standardSecret, at),
    ).toThrow(WebhookSignatureError);
  });

  it("refuses a delivery older or newer than five minutes", () => {
    const signed = headersOf(signStandardWebhook(standardSecret, "msg_4", at, body));
    const later = new Date(at.getTime() + 5 * 60_000 + 1000);
    expect(() => verifyStandardWebhook(body, signed, standardSecret, later)).toThrow(
      WebhookSignatureError,
    );
    const earlier = new Date(at.getTime() - 5 * 60_000 - 1000);
    expect(() => verifyStandardWebhook(body, signed, standardSecret, earlier)).toThrow(
      WebhookSignatureError,
    );
  });
});
