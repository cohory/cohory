import { describe, expect, it } from "vitest";

import { WebhookSignatureError } from "../../stripe-gateway";
import type { Connection } from "../types";
import { createFakeProvider, fakeSignatureHeader, signFakeEvent } from "./adapter";

const conn: Connection = {
  id: "0199f000-0000-7000-8000-0000000000c1",
  communityId: "0199f000-0000-7000-8000-000000000001",
  provider: "polar",
  externalAccountId: "org_fake",
  livemode: false,
  apiCredential: "token",
  webhookSecret: "secret_one",
};

function header(headers: Record<string, string>) {
  return (name: string) => headers[name] ?? null;
}

describe("fake provider", () => {
  it("verifies its own signature and refuses a wrong secret", () => {
    const provider = createFakeProvider();
    const signed = signFakeEvent("secret_one", { id: "ev_1", type: "ping", data: { id: "x" } });
    const event = provider.verifyWebhook(
      { rawBody: signed.rawBody, header: header(signed.headers) },
      conn,
    );
    expect(event).toMatchObject({ id: "ev_1", type: "ping", livemode: false });
    const forged = signFakeEvent("secret_two", { id: "ev_2", type: "ping", data: { id: "x" } });
    expect(() =>
      provider.verifyWebhook({ rawBody: forged.rawBody, header: header(forged.headers) }, conn),
    ).toThrow(WebhookSignatureError);
    expect(() =>
      provider.verifyWebhook(
        { rawBody: signed.rawBody, header: header({ [fakeSignatureHeader]: "00" }) },
        conn,
      ),
    ).toThrow(WebhookSignatureError);
  });

  it("normalizes a payment into a subscription change and a payment without a fee split", async () => {
    const provider = createFakeProvider();
    const events = await provider.normalizeEvent(
      {
        id: "ev_3",
        type: "payment.succeeded",
        account: null,
        livemode: false,
        object: {
          id: "order_1",
          payment: {
            externalId: "order_1",
            subscriptionId: "sub_1",
            paymentRef: "order_1",
            currency: "usd",
            amountMinor: 2900,
            taxMinor: 0,
            paidAt: "2026-10-19T10:00:00.000Z",
          },
        },
      },
      conn,
    );
    expect(events?.map((event) => event.kind)).toEqual([
      "subscription_changed",
      "payment_succeeded",
    ]);
    expect(provider.capabilities(conn).supportsFeeSplit).toBe(false);
  });

  it("behaves like an access token provider", () => {
    const provider = createFakeProvider();
    expect(provider.setup).toBe("access_token");
    expect(provider.expectsLiveEvents({ ...conn, livemode: true })).toBe(true);
  });

  it("answers null for an unknown event type", async () => {
    const provider = createFakeProvider();
    expect(
      await provider.normalizeEvent(
        { id: "ev_4", type: "mystery", account: null, livemode: false, object: { id: "m" } },
        conn,
      ),
    ).toBeNull();
  });
});
