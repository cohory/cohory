import type { BrowserContext, Page } from "@playwright/test";

import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import {
  communityEditionUrl,
  failedInvoiceObject,
  paidInvoiceObjects,
  purchaseIds,
  putStripeObjects,
  deliverWebhook,
  sendWebhook,
  stripeCalls,
  stripeHosts,
  subscriptionObject,
  type Purchase,
} from "../support/stripe";
import { createCommunity, expectNoHorizontalScroll } from "../pages/community";
import { settle } from "../pages/feed";
import { createInviteLink } from "../pages/manage";

const feeLine = /Platform fee: 2% of each successful payment/;
const yearlyMinor = 29_000;
const yearlyFeeMinor = 580;

async function stubStripePages(context: BrowserContext): Promise<void> {
  await context.route(stripeHosts, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html lang='en'><title>Stripe</title><h1>Stripe test page</h1></html>",
    }),
  );
}

function billingDate(seconds: number): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(seconds * 1000),
  );
}

async function expectProcessed(
  baseURL: string,
  type: string,
  object: Record<string, unknown>,
  options: { id?: string; account?: string | null } = {},
): Promise<void> {
  await deliverWebhook(baseURL, type, object, options);
}

async function managePayments(page: Page, slug: string, query = ""): Promise<void> {
  await page.goto(`/c/${slug}/manage/payments${query}`);
  await expect(page.getByRole("heading", { name: "Payments", exact: true })).toBeVisible();
}

test("journeys 2, 4 and 10: a creator sells a membership, a member buys it, then it lapses", async ({
  actor,
  baseURL,
}, testInfo) => {
  test.slow();
  const origin = baseURL ?? "";
  const owner = await actor("Olga", { desktop: true });
  const buyer = await actor("Ben");
  const guest = await actor("Gia", { signedIn: false });
  await Promise.all([owner.context, buyer.context].map(stubStripePages));
  const slug = await createCommunity(owner.page, `Paid ${uniqueSuffix()}`, "private");

  const account = await test.step("journey 2: the owner connects Stripe", async () => {
    await managePayments(owner.page, slug);
    await expect(owner.page.getByText(feeLine)).toHaveCount(1);
    await expectAccessible(owner.page, "manage payments (not connected)");
    await settle(owner.page);
    await owner.page.getByRole("button", { name: "Connect your Stripe account" }).click();
    await expect(owner.page).toHaveURL(/^https:\/\/connect\.stripe\.test\/onboard\/acct_/);
    const connected = new URL(owner.page.url()).pathname.split("/").pop() ?? "";
    const link = (await stripeCalls(connected)).find(
      (call) => call.path === "/v2/core/account_links",
    );
    expect(link?.idempotencyKey, "account link idempotency key").toBeTruthy();

    await managePayments(owner.page, slug, "?stripe=return");
    await expect(owner.page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(owner.page.getByText("Test mode", { exact: true })).toBeVisible();
    await expect(owner.page.getByText(feeLine)).toHaveCount(1);
    await expectAccessible(owner.page, "manage payments (connected)");
    return connected;
  });

  await test.step("journey 2: the owner saves $29 a month and $290 a year", async () => {
    await settle(owner.page);
    await owner.page.getByLabel("Currency").selectOption("usd");
    await owner.page.getByLabel("Monthly price").fill("29");
    await owner.page.getByRole("button", { name: "Add an annual price" }).click();
    await owner.page.getByLabel("Yearly price").fill("290");
    await owner.page.getByRole("button", { name: "Put on sale" }).click();
    await expect(owner.page.getByText(/\$29\.00 per month or \$290\.00 per year/)).toBeVisible();
    const prices = (await stripeCalls(account)).filter((call) => call.path === "/v1/prices");
    expect(prices.map((call) => call.body["unit_amount"]).sort()).toEqual(["2900", "29000"]);
    expect(prices.every((call) => call.idempotencyKey)).toBe(true);
    await expectAccessible(owner.page, "manage payments (plan saved)");
  });

  await test.step("journey 4: a signed out visitor sees the price and the membership page", async () => {
    await guest.page.goto(`/c/${slug}`);
    const join = guest.page.getByRole("button", { name: "Join for $29.00/month" }).first();
    await expect(join).toBeVisible();
    await expectAccessible(guest.page, "community about (paid, signed out)");
    await join.click();
    await expect(guest.page).toHaveURL(
      (url) =>
        url.pathname === "/sign-up" &&
        url.searchParams.get("next") === `/c/${slug}/join?intent=checkout`,
    );
    await guest.page.goto(`/c/${slug}/membership`);
    await expect(
      guest.page.getByRole("heading", { name: "Membership", exact: true }).first(),
    ).toBeVisible();
    await expectAccessible(guest.page, "membership (signed out)");
  });

  await test.step("an invite to a paid community does not waive the price", async () => {
    const invite = await createInviteLink(owner.page, slug);
    const token = new URL(invite).pathname.split("/").pop() ?? "";
    const redeem = await buyer.context.request.post(`/api/v1/invites/${token}/redeem`, {
      headers: { origin },
    });
    expect(redeem.status(), "invite redeem on a paid community").toBe(402);
    expect(await redeem.json()).toMatchObject({ error: { code: "payment_required" } });

    await buyer.page.goto(invite);
    await expectAccessible(buyer.page, "join page (paid community)");
    await settle(buyer.page);
    await buyer.page.getByRole("button", { name: "Join community" }).click();
    await expect(buyer.page).toHaveURL((url) => url.pathname === `/c/${slug}/membership`, {
      timeout: 30_000,
    });
  });

  const checkout =
    await test.step("journey 4: the buyer picks yearly and goes to Checkout", async () => {
      await buyer.page.goto(`/c/${slug}/membership`);
      await expect(buyer.page.getByRole("radio", { name: "Monthly" })).toBeChecked();
      await expect(buyer.page.getByRole("button", { name: "Join for $29.00/month" })).toBeVisible();
      await expectAccessible(buyer.page, "membership (signed in, not a member)");
      if (testInfo.project.name === "mobile") await expectNoHorizontalScroll(buyer.page);
      await settle(buyer.page);
      await buyer.page.getByText("Yearly", { exact: true }).click();
      const buy = buyer.page.getByRole("button", { name: "Join for $290.00/year" });
      await expect(buy).toBeVisible();
      await buy.click();
      await expect(buyer.page).toHaveURL(/^https:\/\/checkout\.stripe\.test\/pay\/cs_/);
      const call = (await stripeCalls(account)).find(
        (entry) => entry.path === "/v1/checkout/sessions",
      );
      expect(call, "checkout session on the connected account").toBeTruthy();
      const body = call?.body ?? {};
      expect(body["subscription_data[application_fee_percent]"]).toBe("2");
      expect(call?.idempotencyKey ?? "").toMatch(/^checkout:/);
      expect(body["success_url"]).toContain(`/c/${slug}/membership?checkout=success`);
      const purchase: Purchase = {
        account,
        communityId: body["metadata[cohory_community_id]"] ?? "",
        userId: body["metadata[cohory_user_id]"] ?? "",
        planId: body["metadata[cohory_plan_id]"] ?? "",
        priceId: body["line_items[0][price]"] ?? "",
        suffix: uniqueSuffix(),
        periodEnd: Math.floor(Date.now() / 1000) + 365 * 86_400,
      };
      expect(
        purchase.communityId && purchase.userId && purchase.planId && purchase.priceId,
      ).toBeTruthy();
      return {
        purchase,
        successUrl: (body["success_url"] ?? "").replace("{CHECKOUT_SESSION_ID}", "cs_e2e"),
      };
    });
  const { purchase } = checkout;
  const ids = purchaseIds(purchase);

  await test.step("journey 4: signed webhooks activate the membership", async () => {
    await buyer.page.goto(checkout.successUrl);
    await expect(buyer.page.getByText("Finishing setup")).toBeVisible();

    await putStripeObjects({
      subscriptions: { [ids.subscription]: subscriptionObject(purchase, "active", "year") },
      ...paidInvoiceObjects(purchase, yearlyMinor, yearlyFeeMinor),
    });
    const forged = await sendWebhook(
      origin,
      "checkout.session.completed",
      { id: "cs_forged", object: "checkout.session" },
      { account, secret: "whsec_wrong" },
    );
    expect(forged.status, "a wrong signature is refused").toBe(400);
    const session = {
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
    };
    const eventId = `evt_e2e_checkout_${purchase.suffix}`;
    await expectProcessed(origin, "checkout.session.completed", session, { account, id: eventId });
    const again = await sendWebhook(origin, "checkout.session.completed", session, {
      account,
      id: eventId,
    });
    expect(again, "duplicate delivery").toEqual({ status: 200, outcome: "duplicate" });
    await expectProcessed(
      origin,
      "customer.subscription.created",
      {
        id: ids.subscription,
        object: "subscription",
      },
      { account },
    );
    await expectProcessed(
      origin,
      "invoice.paid",
      { id: ids.invoice, object: "invoice" },
      { account },
    );
    await expectProcessed(origin, "application_fee.created", {
      id: ids.fee,
      object: "application_fee",
      account,
    });

    await expect(buyer.page.getByText("You're in")).toBeVisible({ timeout: 30_000 });
    await expect(
      buyer.page.getByText(
        `Membership. $290.00 per year. Next payment ${billingDate(purchase.periodEnd)}.`,
      ),
    ).toBeVisible();
    await expectAccessible(buyer.page, "membership (you're in)");
    if (testInfo.project.name === "mobile") await expectNoHorizontalScroll(buyer.page);

    await buyer.page.goto(`/c/${slug}/members`);
    await expect(buyer.page).toHaveURL((url) => url.pathname === `/c/${slug}/members`);
    await expectAccessible(buyer.page, "members (paid member)");
  });

  await test.step("journey 2: the owner sees the paid member and a 2% fee", async () => {
    await managePayments(owner.page, slug);
    const table = owner.page.locator("[data-slot='subscription-table']");
    await expect(table.getByText(buyer.person.name, { exact: true })).toBeVisible();
    await expect(table.getByText("Active", { exact: true })).toBeVisible();
    await expect(owner.page.getByText("$290.00").first()).toBeVisible();
    await expect(owner.page.getByText("$5.80")).toBeVisible();
    await expect(owner.page.getByText(feeLine)).toHaveCount(1);
    await expectAccessible(owner.page, "manage payments (paid member)");

    await owner.page.setViewportSize({ width: 390, height: 844 });
    const period = table
      .getByText(`Renews ${billingDate(purchase.periodEnd)}`)
      .filter({ visible: true });
    await expect(period).toBeVisible();
    const box = await period.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390, "period inside 390 wide").toBe(true);
    const tableOverflow = await table.evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(tableOverflow, "paid members table scrolls sideways").toBeLessThanOrEqual(0);
    await expectNoHorizontalScroll(owner.page);
    await expectAccessible(owner.page, "manage payments (390 wide)");
    await owner.page.setViewportSize({ width: 1280, height: 900 });
  });

  await test.step("journey 10: a failed renewal keeps access and shows the banner", async () => {
    await putStripeObjects({
      subscriptions: { [ids.subscription]: subscriptionObject(purchase, "past_due", "year") },
      ...failedInvoiceObject(purchase, yearlyMinor),
    });
    await expectProcessed(
      origin,
      "invoice.payment_failed",
      {
        id: `${ids.invoice}_retry`,
        object: "invoice",
      },
      { account },
    );
    await expectProcessed(
      origin,
      "customer.subscription.updated",
      {
        id: ids.subscription,
        object: "subscription",
      },
      { account },
    );

    await buyer.page.goto(`/c/${slug}`);
    await expect(buyer.page.getByText("Payment failed").first()).toBeVisible();
    await expect(buyer.page.getByRole("link", { name: "Manage billing" })).toBeVisible();
    await expectAccessible(buyer.page, "community (past due)");
    await buyer.page.goto(`/c/${slug}/members`);
    await expect(buyer.page).toHaveURL((url) => url.pathname === `/c/${slug}/members`);

    await buyer.page.goto(`/c/${slug}/membership`);
    await expect(buyer.page.getByText("Payment failed").first()).toBeVisible();
    await expectAccessible(buyer.page, "membership (past due)");
    await settle(buyer.page);
    await buyer.page.getByRole("button", { name: "Manage billing" }).click();
    await expect(buyer.page).toHaveURL(/^https:\/\/billing\.stripe\.test\/portal\/cus_/);
  });

  await test.step("journey 10: cancellation removes access to the private community", async () => {
    await putStripeObjects({
      subscriptions: {
        [ids.subscription]: subscriptionObject(
          purchase,
          "canceled",
          "year",
          Math.floor(Date.now() / 1000),
        ),
      },
    });
    await expectProcessed(
      origin,
      "customer.subscription.deleted",
      {
        id: ids.subscription,
        object: "subscription",
      },
      { account },
    );

    await buyer.page.goto(`/c/${slug}/members`);
    await expect(buyer.page).not.toHaveURL((url) => url.pathname === `/c/${slug}/members`);
    await buyer.page.goto(`/c/${slug}`);
    await expect(
      buyer.page.getByRole("button", { name: "Join for $29.00/month" }).first(),
    ).toBeVisible();
    await expectAccessible(buyer.page, "community about (canceled)");

    await managePayments(owner.page, slug);
    await expect(
      owner.page.locator("[data-slot='subscription-table']").getByText("Canceled", { exact: true }),
    ).toBeVisible();
    await expectAccessible(owner.page, "manage payments (canceled)");
  });
});

test("Community Edition: Manage Payments offers your own Stripe keys, no platform fee, and no Polar", async ({
  actor,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one edition check per run is enough");
  const owner = await actor("Cora", { desktop: true });
  const slug = await createCommunity(owner.page, `Self hosted ${uniqueSuffix()}`, "public");

  await owner.page.goto(`${communityEditionUrl}/c/${slug}/manage/payments`);
  await expect(owner.page.getByRole("heading", { name: "Payments", exact: true })).toBeVisible();
  await expect(
    owner.page.getByText("No platform fee. Stripe processing fees are separate."),
  ).toHaveCount(1);
  await expect(owner.page.getByText(/Platform fee: /)).toHaveCount(0);
  await expect(owner.page.getByText("Your own Stripe account", { exact: true })).toBeVisible();
  await expect(owner.page.getByLabel("Secret key")).toBeVisible();
  await expect(owner.page.getByLabel("Webhook signing secret")).toBeVisible();
  await expect(owner.page.getByRole("button", { name: "Connect your Stripe account" })).toHaveCount(
    0,
  );
  await expect(owner.page.getByRole("radio", { name: /Polar/ })).toHaveCount(0);
  await expect(owner.page.getByRole("button", { name: "Connect Polar" })).toHaveCount(0);
  await expectAccessible(owner.page, "manage payments (Community Edition)");
});
