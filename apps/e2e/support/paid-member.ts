import { expect, type Page } from "@playwright/test";

import { settle } from "../pages/feed";
import { uniqueSuffix } from "./people";
import {
  deliverWebhook,
  purchaseIds,
  putStripeObjects,
  stripeCalls,
  subscriptionObject,
  type Purchase,
} from "./stripe";

export async function processed(
  baseURL: string,
  type: string,
  object: Record<string, unknown>,
  account: string,
): Promise<void> {
  await deliverWebhook(baseURL, type, object, { account, id: `evt_e2e_exit_${uniqueSuffix()}` });
}

export async function buyMembership(page: Page, slug: string, account: string): Promise<Purchase> {
  await page
    .context()
    .route(/^https:\/\/(connect|checkout|billing)\.stripe\.test\//, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<title>Stripe</title>" }),
    );
  await page.goto(`/c/${slug}/membership`);
  await settle(page);
  await page.getByRole("button", { name: "Join for $29.00/month" }).click();
  await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.test\/pay\/cs_/);
  const call = (await stripeCalls(account)).find((entry) => entry.path === "/v1/checkout/sessions");
  const body = call?.body ?? {};
  return {
    account,
    communityId: body["metadata[cohory_community_id]"] ?? "",
    userId: body["metadata[cohory_user_id]"] ?? "",
    planId: body["metadata[cohory_plan_id]"] ?? "",
    priceId: body["line_items[0][price]"] ?? "",
    suffix: uniqueSuffix(),
    periodEnd: Math.floor(Date.now() / 1000) + 30 * 86_400,
  };
}

export async function payingMember(
  page: Page,
  slug: string,
  account: string,
  origin: string,
): Promise<Purchase> {
  const bought = await buyMembership(page, slug, account);
  const ids = purchaseIds(bought);
  await putStripeObjects({
    subscriptions: { [ids.subscription]: subscriptionObject(bought, "active", "month") },
  });
  await processed(
    origin,
    "checkout.session.completed",
    {
      id: `cs_${ids.subscription}`,
      object: "checkout.session",
      mode: "subscription",
      subscription: ids.subscription,
      customer: ids.customer,
      metadata: {
        cohory_community_id: bought.communityId,
        cohory_user_id: bought.userId,
        cohory_plan_id: bought.planId,
      },
    },
    account,
  );
  await processed(
    origin,
    "customer.subscription.created",
    { id: ids.subscription, object: "subscription" },
    account,
  );
  return bought;
}

export function endDate(seconds: number): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(seconds * 1000),
  );
}
