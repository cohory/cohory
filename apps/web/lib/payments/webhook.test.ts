import type { PaymentsService } from "@cohory/payments";
import { describe, expect, it, vi } from "vitest";

import { handleWebhookRequest } from "./webhook";

function service() {
  return { handleWebhook: vi.fn<PaymentsService["handleWebhook"]>() };
}

const rawBody =
  '{"id":"evt_1",  "type":"invoice.paid","data":{"object":{"id":"in_1","note":"café"}}}\n';

function request(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/webhooks/payments/conn-1", {
    method: "POST",
    body: rawBody,
    headers: { "content-type": "application/json", cookie: "session=secret", ...headers },
  });
}

describe("payments webhook routes", () => {
  it("hands the exact raw body and only the signature headers to the service", async () => {
    const stub = service();
    stub.handleWebhook.mockResolvedValue({ status: 200, outcome: "processed" });

    const response = await handleWebhookRequest(
      stub,
      { setup: "access_token", connectionId: "conn-1" },
      request({
        "webhook-id": "msg_1",
        "webhook-timestamp": "1760868000",
        "webhook-signature": "v1,abc",
      }),
    );

    expect(stub.handleWebhook).toHaveBeenCalledWith(
      { setup: "access_token", connectionId: "conn-1" },
      {
        rawBody,
        headers: {
          "stripe-signature": null,
          "webhook-id": "msg_1",
          "webhook-timestamp": "1760868000",
          "webhook-signature": "v1,abc",
        },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, outcome: "processed" });
  });

  it("passes the Stripe signature for the own keys route", async () => {
    const stub = service();
    stub.handleWebhook.mockResolvedValue({ status: 500, outcome: "failed" });

    const response = await handleWebhookRequest(
      stub,
      { setup: "own_keys", connectionId: "conn-1" },
      request({ "stripe-signature": "t=1,v1=abc" }),
    );

    expect(stub.handleWebhook).toHaveBeenCalledWith(
      { setup: "own_keys", connectionId: "conn-1" },
      expect.objectContaining({
        rawBody,
        headers: expect.objectContaining({ "stripe-signature": "t=1,v1=abc" }),
      }),
    );
    expect(response.status).toBe(500);
  });

  it("answers with the service status so the provider retries", async () => {
    const stub = service();
    stub.handleWebhook.mockResolvedValue({ status: 503, outcome: "not_configured" });
    const response = await handleWebhookRequest(
      stub,
      { setup: "access_token", connectionId: "conn-1" },
      new Request("http://localhost/api/webhooks/payments/conn-1", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ received: false, outcome: "not_configured" });
  });
});
