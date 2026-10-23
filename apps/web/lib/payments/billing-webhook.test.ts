import type { PaymentsService } from "@cohory/payments";
import type { PlatformBillingService } from "@cohory/payments/billing";
import { describe, expect, it, vi } from "vitest";

import { handlePlatformStripeWebhookRequest } from "./billing-webhook";

const rawBody = '{"id":"evt_1","type":"invoice.paid","data":{"object":{"id":"in_1"}}}';

function request(): Request {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body: rawBody,
    headers: { "stripe-signature": "t=1,v1=abc" },
  });
}

function stubs() {
  return {
    payments: { handleWebhook: vi.fn<PaymentsService["handleWebhook"]>() },
    billing: {
      handlePlatformBillingWebhook: vi.fn<PlatformBillingService["handlePlatformBillingWebhook"]>(),
    },
  };
}

describe("platform Stripe webhook route", () => {
  it("lets platform billing answer its own invoice events", async () => {
    const { payments, billing } = stubs();
    billing.handlePlatformBillingWebhook.mockResolvedValue({ status: 200, outcome: "processed" });

    const response = await handlePlatformStripeWebhookRequest(payments, billing, request());

    expect(billing.handlePlatformBillingWebhook).toHaveBeenCalledWith({
      rawBody,
      signature: "t=1,v1=abc",
    });
    expect(payments.handleWebhook).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ received: true, outcome: "processed" });
  });

  it("hands every other event to the payments handler with the same raw body", async () => {
    const { payments, billing } = stubs();
    billing.handlePlatformBillingWebhook.mockResolvedValue(null);
    payments.handleWebhook.mockResolvedValue({ status: 400, outcome: "invalid_signature" });

    const response = await handlePlatformStripeWebhookRequest(payments, billing, request());

    expect(payments.handleWebhook).toHaveBeenCalledWith(
      { setup: "platform_account" },
      expect.objectContaining({
        rawBody,
        headers: expect.objectContaining({ "stripe-signature": "t=1,v1=abc" }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
