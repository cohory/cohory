import type { BrowserContext } from "@playwright/test";

import { uniqueSuffix } from "../support/people";
import {
  deliverWebhook,
  paidInvoiceObjects,
  purchaseIds,
  putStripeObjects,
  stripeCalls,
  stripeHosts,
  subscriptionObject,
  type Purchase,
} from "../support/stripe";

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3310";

export async function stubStripePages(context: BrowserContext): Promise<void> {
  await context.route(stripeHosts, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html lang='en'><title>Stripe</title><h1>Stripe test page</h1></html>",
    }),
  );
}

async function processed(type: string, object: Record<string, unknown>, account: string) {
  await deliverWebhook(baseUrl, type, object, { account });
}

export async function payCheckout(account: string): Promise<Purchase> {
  const calls = (await stripeCalls(account)).filter(
    (entry) => entry.method === "POST" && entry.path === "/v1/checkout/sessions",
  );
  const body = calls[calls.length - 1]?.body ?? {};
  const purchase: Purchase = {
    account,
    communityId: body["metadata[cohory_community_id]"] ?? "",
    userId: body["metadata[cohory_user_id]"] ?? "",
    planId: body["metadata[cohory_plan_id]"] ?? "",
    priceId: body["line_items[0][price]"] ?? "",
    suffix: uniqueSuffix(),
    periodEnd: Math.floor(Date.now() / 1000) + 30 * 86_400,
  };
  const ids = purchaseIds(purchase);
  await putStripeObjects({
    subscriptions: { [ids.subscription]: subscriptionObject(purchase, "active", "month") },
    ...paidInvoiceObjects(purchase, 2_900, 29),
  });
  await processed(
    "checkout.session.completed",
    {
      id: `cs_${ids.subscription}`,
      object: "checkout.session",
      mode: "subscription",
      subscription: ids.subscription,
      customer: ids.customer,
      metadata: {
        cohory_community_id: purchase.communityId,
        cohory_user_id: purchase.userId,
        cohory_plan_id: purchase.planId,
      },
    },
    account,
  );
  await processed(
    "customer.subscription.created",
    { id: ids.subscription, object: "subscription" },
    account,
  );
  await processed("invoice.paid", { id: ids.invoice, object: "invoice" }, account);
  return purchase;
}
