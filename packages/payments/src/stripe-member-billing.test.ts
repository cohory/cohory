import { describe, expect, it } from "vitest";

import { createStripeGateway } from "./stripe-gateway";
import { withStripeServer, type CapturedRequest } from "./test/stripe-server";

const periodEnd = 1_795_006_302;

function subscriptionObject(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    object: "subscription",
    status: "active",
    customer: "cus_1",
    metadata: {},
    cancel_at: null,
    cancel_at_period_end: false,
    ended_at: null,
    pause_collection: null,
    application_fee_percent: 2,
    items: {
      object: "list",
      data: [
        {
          id: "si_1",
          current_period_end: periodEnd,
          price: { id: "price_month", recurring: { interval: "month", interval_count: 1 } },
        },
      ],
    },
    ...overrides,
  };
}

function form(request: CapturedRequest | undefined): URLSearchParams {
  return new URLSearchParams(request?.body ?? "");
}

describe("subscriptionOf with a collection pause", () => {
  it("reads a paused subscription as paused with access through the paid period", async () => {
    const paidThrough = "2026-11-18T10:00:00.000Z";
    await withStripeServer(
      subscriptionObject({
        pause_collection: { behavior: "void", resumes_at: periodEnd + 86_400 * 60 },
        metadata: { cohory_paid_through: paidThrough },
      }),
      async (baseUrl) => {
        const gateway = createStripeGateway("sk_test_pause", { apiBaseUrl: baseUrl });
        const paused = await gateway.retrieveSubscription("acct_1", "sub_1");

        expect(paused.status).toBe("paused");
        expect(paused.currentPeriodEnd).toEqual(new Date(paidThrough));
      },
    );
  });

  it("reads a subscription without a pause_collection field as not paused", async () => {
    const withoutPause: Record<string, unknown> = subscriptionObject();
    delete withoutPause["pause_collection"];
    await withStripeServer(withoutPause, async (baseUrl) => {
      const gateway = createStripeGateway("sk_test_pause", { apiBaseUrl: baseUrl });
      const subscription = await gateway.retrieveSubscription("acct_1", "sub_1");

      expect(subscription.status).toBe("active");
    });
  });

  it("falls back to the period end for a pause set outside cohory", async () => {
    await withStripeServer(
      subscriptionObject({ pause_collection: { behavior: "void", resumes_at: null } }),
      async (baseUrl) => {
        const gateway = createStripeGateway("sk_test_pause", { apiBaseUrl: baseUrl });
        const paused = await gateway.retrieveSubscription("acct_1", "sub_1");

        expect(paused.status).toBe("paused");
        expect(paused.currentPeriodEnd?.getTime()).toBe(periodEnd * 1000);
      },
    );
  });
});

describe("member billing writes", () => {
  it("pauses collection by voiding invoices until the resume date, with the key", async () => {
    await withStripeServer(subscriptionObject(), async (baseUrl, captured) => {
      const gateway = createStripeGateway("sk_test_pause", { apiBaseUrl: baseUrl });
      await gateway.pauseSubscription(
        "acct_1",
        "sub_1",
        {
          resumesAt: new Date("2027-01-18T10:00:00.000Z"),
          paidThrough: new Date("2026-11-18T10:00:00.000Z"),
        },
        "pause:sub_1:2",
      );

      const [request] = captured;
      expect(request?.path).toBe("/v1/subscriptions/sub_1");
      expect(form(request).get("pause_collection[behavior]")).toBe("void");
      expect(form(request).get("pause_collection[resumes_at]")).toBe(
        String(Date.parse("2027-01-18T10:00:00.000Z") / 1000),
      );
      expect(form(request).get("metadata[cohory_paid_through]")).toBe("2026-11-18T10:00:00.000Z");
      expect(request?.idempotencyKey).toBe("pause:sub_1:2");
      expect(request?.account).toBe("acct_1");
    });
  });

  it("resumes collection and clears the paid through date", async () => {
    await withStripeServer(subscriptionObject(), async (baseUrl, captured) => {
      const gateway = createStripeGateway("sk_test_pause", { apiBaseUrl: baseUrl });
      await gateway.resumeSubscription("acct_1", "sub_1", "resume:sub_1");

      expect(form(captured[0]).get("pause_collection")).toBe("");
      expect(form(captured[0]).get("metadata[cohory_paid_through]")).toBe("");
      expect(captured[0]?.idempotencyKey).toBe("resume:sub_1");
    });
  });

  it("sends the member's reason as cancellation details", async () => {
    await withStripeServer(subscriptionObject(), async (baseUrl, captured) => {
      const gateway = createStripeGateway("sk_test_reason", { apiBaseUrl: baseUrl });
      await gateway.setCancellationDetails(
        "acct_1",
        "sub_1",
        { feedback: "too_expensive", comment: "Money is tight" },
        "cancel-reason:sub_1:abc",
      );

      expect(form(captured[0]).get("cancellation_details[feedback]")).toBe("too_expensive");
      expect(form(captured[0]).get("cancellation_details[comment]")).toBe("Money is tight");
      expect(captured[0]?.idempotencyKey).toBe("cancel-reason:sub_1:abc");
    });
  });

  it("opens the portal on the cancel flow and returns to the membership page", async () => {
    await withStripeServer(
      { id: "bps_1", object: "billing_portal.session", url: "https://billing.test/s" },
      async (baseUrl, captured) => {
        const gateway = createStripeGateway("sk_test_portal", { apiBaseUrl: baseUrl });
        const session = await gateway.createPortalSession(
          "acct_1",
          {
            customerId: "cus_1",
            returnUrl: "https://app.test/c/x/membership",
            flow: { type: "subscription_cancel", subscriptionId: "sub_1" },
          },
          "portal:cancel:1",
        );

        const sent = form(captured[0]);
        expect(session.url).toBe("https://billing.test/s");
        expect(sent.get("flow_data[type]")).toBe("subscription_cancel");
        expect(sent.get("flow_data[subscription_cancel][subscription]")).toBe("sub_1");
        expect(sent.get("flow_data[after_completion][type]")).toBe("redirect");
        expect(sent.get("flow_data[after_completion][redirect][return_url]")).toBe(
          "https://app.test/c/x/membership",
        );
      },
    );
  });

  it("brands checkout with the cancel note and expires it at the given time", async () => {
    await withStripeServer(
      { id: "cs_1", object: "checkout.session", url: "https://checkout.test/cs_1" },
      async (baseUrl, captured) => {
        const gateway = createStripeGateway("sk_test_checkout", { apiBaseUrl: baseUrl });
        await gateway.createCheckoutSession(
          "acct_1",
          {
            priceId: "price_month",
            customerId: null,
            customerEmail: "a@example.test",
            clientReferenceId: "user",
            metadata: {},
            applicationFeePercent: null,
            trialEnd: null,
            expiresAt: new Date("2026-10-23T10:00:00.000Z"),
            submitMessage: "Cancel anytime from your membership page in Makers.",
            successUrl: "https://app.test/ok",
            cancelUrl: "https://app.test/back",
          },
          "checkout:1",
        );

        const sent = form(captured[0]);
        expect(sent.get("custom_text[submit][message]")).toBe(
          "Cancel anytime from your membership page in Makers.",
        );
        expect(sent.get("expires_at")).toBe(String(Date.parse("2026-10-23T10:00:00.000Z") / 1000));
      },
    );
  });

  it("puts the community image on the product", async () => {
    await withStripeServer({ id: "prod_1", object: "product" }, async (baseUrl, captured) => {
      const gateway = createStripeGateway("sk_test_product", { apiBaseUrl: baseUrl });
      await gateway.createProduct(
        "acct_1",
        { name: "Makers", images: ["https://cdn.test/logo.png"], metadata: {} },
        "plan:p:product",
      );

      expect(form(captured[0]).get("images[0]")).toBe("https://cdn.test/logo.png");
    });
  });
});
