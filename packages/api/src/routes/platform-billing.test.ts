import { ForbiddenError } from "@cohory/authz";
import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import { newId } from "@cohory/db";
import { PaymentsValidationError, StripeRejectedError } from "@cohory/payments";
import type { PlatformBillingService, PlatformFeesView } from "@cohory/payments/billing";
import { createPostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { apiDeps } from "../services";

import { createApi, createOpenApiDocument } from "../app";
import type { SessionResolver } from "../middleware/session";

const sessionHeader = "x-test-user";
const resolveSession: SessionResolver = async (headers) => {
  const userId = headers.get(sessionHeader);
  return userId ? { userId } : null;
};

type Stub = { [K in keyof PlatformBillingService]: Mock<PlatformBillingService[K]> };

const communityId = newId();
const userId = newId();
let stub: Stub;
let api: ReturnType<typeof createApi>;

const view: PlatformFeesView = {
  available: true,
  feeBps: 200,
  periodStart: new Date("2026-11-01T00:00:00.000Z"),
  nextInvoiceAt: new Date("2026-12-01T00:00:00.000Z"),
  balances: [{ currency: "usd", currentMinor: 120, carriedMinor: 300, minimumMinor: 500 }],
  billingEmail: "billing@example.test",
  ownerEmail: "owner@example.test",
  paymentMethodLabel: null,
  suspended: false,
  canManage: true,
  invoices: [
    {
      id: newId(),
      currency: "usd",
      periodStart: new Date("2026-10-01T00:00:00.000Z"),
      periodEnd: new Date("2026-11-01T00:00:00.000Z"),
      amountMinor: 700,
      amountPaidMinor: 0,
      status: "open",
      displayStatus: "past_due",
      number: "CHY-1",
      hostedInvoiceUrl: "https://invoice.stripe.com/i/x",
      dueAt: new Date("2026-11-15T00:00:00.000Z"),
      paidAt: null,
      pastDueSince: new Date("2026-11-16T00:00:00.000Z"),
    },
  ],
  issues: [],
};

beforeEach(() => {
  stub = {
    getPlatformFees: vi.fn<PlatformBillingService["getPlatformFees"]>(),
    updateBillingEmail: vi.fn<PlatformBillingService["updateBillingEmail"]>(),
    startPaymentMethodSetup: vi.fn<PlatformBillingService["startPaymentMethodSetup"]>(),
    completePaymentMethodSetup: vi.fn<PlatformBillingService["completePaymentMethodSetup"]>(),
    isBillingSuspended: vi.fn<PlatformBillingService["isBillingSuspended"]>(),
    generateInvoices: vi.fn<PlatformBillingService["generateInvoices"]>(),
    voidPlatformInvoice: vi.fn<PlatformBillingService["voidPlatformInvoice"]>(),
    resendPlatformInvoice: vi.fn<PlatformBillingService["resendPlatformInvoice"]>(),
    syncPlatformInvoice: vi.fn<PlatformBillingService["syncPlatformInvoice"]>(),
    reconcile: vi.fn<PlatformBillingService["reconcile"]>(),
    handlePlatformBillingWebhook: vi.fn<PlatformBillingService["handlePlatformBillingWebhook"]>(),
    processBillingWebhookEvent: vi.fn<PlatformBillingService["processBillingWebhookEvent"]>(),
  };
  const platformBilling: PlatformBillingService = stub;
  api = createApi(() =>
    apiDeps({
      resolveSession,
      communities: createCommunitiesService(createFakeRepository()),
      posts: createPostsService({
        repo: createFakePostsRepository(),
        storage: {
          put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
          publicUrl: (k) => k,
        },
      }),
      platformBilling,
    }),
  );
});

function call(path: string, init: { method?: string; body?: unknown; signedIn?: boolean } = {}) {
  const headers = new Headers();
  if (init.signedIn ?? true) headers.set(sessionHeader, userId);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return api.request(`/api/v1/communities/${communityId}/payments/platform-fees${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

describe("platform billing routes", () => {
  it("returns the platform fees view with ISO dates", async () => {
    stub.getPlatformFees.mockResolvedValue(view);

    const response = await call("");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      invoices: { displayStatus: string; dueAt: string }[];
    };
    expect(body.invoices[0]).toMatchObject({
      displayStatus: "past_due",
      dueAt: "2026-11-15T00:00:00.000Z",
    });
    expect(body).not.toHaveProperty("ownerEmail");
    expect(stub.getPlatformFees).toHaveBeenCalledWith(
      { kind: "user", userId, platformAdmin: false },
      communityId,
    );
  });

  it("maps service errors to HTTP statuses", async () => {
    stub.getPlatformFees.mockRejectedValue(new ForbiddenError("read", "payment"));
    stub.updateBillingEmail.mockRejectedValue(
      new PaymentsValidationError([{ path: "email", message: "Invalid email" }]),
    );
    stub.startPaymentMethodSetup.mockRejectedValue(new StripeRejectedError("api_error"));

    expect((await call("")).status).toBe(403);
    expect((await call("/billing-email", { method: "PUT", body: { email: "x" } })).status).toBe(
      422,
    );
    expect((await call("/payment-method", { method: "POST" })).status).toBe(409);
  });

  it("logs an unexpected error once and answers 500", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    stub.getPlatformFees.mockRejectedValue(new Error("boom"));

    const response = await call("");

    const lines = logged.mock.calls.map(([line]) => String(line));
    logged.mockRestore();
    expect(response.status).toBe(500);
    expect(lines.filter((line) => line.includes("unhandled api error"))).toHaveLength(1);
  });

  it("saves the billing email and starts the hosted card setup", async () => {
    stub.updateBillingEmail.mockResolvedValue({ billingEmail: "billing@example.test" });
    stub.startPaymentMethodSetup.mockResolvedValue({ url: "https://checkout.stripe.com/c/x" });

    const saved = await call("/billing-email", {
      method: "PUT",
      body: { email: "billing@example.test" },
    });
    const setup = await call("/payment-method", { method: "POST" });

    expect(await saved.json()).toEqual({ billingEmail: "billing@example.test" });
    expect(await setup.json()).toEqual({ url: "https://checkout.stripe.com/c/x" });
  });

  it("documents the operations in OpenAPI", () => {
    const document = createOpenApiDocument();
    const path = document.paths?.["/api/v1/communities/{communityId}/payments/platform-fees"];
    expect(path?.get?.operationId).toBe("getPlatformFees");
  });
});
