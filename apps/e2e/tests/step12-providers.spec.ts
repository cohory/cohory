import { expectAccessible } from "../support/axe";
import { query } from "../support/db";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { newWebhookSecret, polarCalls, polarHost, registerPolarEndpoint } from "../support/polar";
import { createCommunity } from "../pages/community";
import { settle } from "../pages/feed";

test("a creator sells through Polar and a member buys, then cancels in the portal", async ({
  actor,
}) => {
  test.slow();
  const owner = await actor("Pia", { desktop: true });
  const buyer = await actor("Paul", { desktop: true });
  const slug = await createCommunity(owner.page, `Polar ${uniqueSuffix()}`, "private");
  const payments = `/c/${slug}/manage/payments`;

  const webhookPath = await test.step("the owner connects Polar with a sandbox token", async () => {
    await owner.page.goto(payments);
    await settle(owner.page);
    await owner.page.getByRole("radio", { name: /Polar/ }).check();
    await expect(owner.page.getByText(/platform fee is recorded on each payment/)).toBeVisible();
    await owner.page.getByLabel("Organization access token").fill("polar_oat_e2e_sandbox_token");
    await owner.page.getByRole("button", { name: "Connect Polar" }).click();
    const webhook = owner.page.getByRole("region", { name: "Webhook" });
    await expect(webhook).toBeVisible({ timeout: 30_000 });
    await expect(webhook.getByText("Waiting for the signing secret.")).toBeVisible();
    const url = (await webhook.locator("p.font-mono").innerText()).trim();
    expect(url).toMatch(/\/api\/webhooks\/payments\/[0-9a-f-]{36}$/);
    await expectAccessible(owner.page, "manage payments (Polar, waiting for secret)");
    return new URL(url).pathname;
  });

  await test.step("the owner saves the signing secret and sends a test event", async () => {
    const secret = newWebhookSecret();
    await registerPolarEndpoint(webhookPath, secret);
    const webhook = owner.page.getByRole("region", { name: "Webhook" });
    await webhook.getByLabel("Webhook signing secret").fill(secret);
    await webhook.getByRole("button", { name: "Save signing secret" }).click();
    await expect(webhook.getByText("No events received yet.")).toBeVisible();
    await webhook.getByRole("button", { name: "Send test event" }).click();
    await expect(webhook.getByText(/^Last event received /)).toBeVisible({ timeout: 30_000 });
  });

  await test.step("the owner sets $29 a month and Polar gets a product", async () => {
    await owner.page.reload();
    await settle(owner.page);
    await owner.page.getByLabel("Currency").selectOption("usd");
    await owner.page.getByLabel("Monthly price").fill("29");
    await owner.page.getByRole("button", { name: "Put on sale" }).click();
    await expect(owner.page.getByText(/\$29\.00 per month/)).toBeVisible();
    const products = (await polarCalls()).filter(
      (call) => call.method === "POST" && call.path === "/v1/products/",
    );
    expect(products.length).toBeGreaterThan(0);
    await expectAccessible(owner.page, "manage payments (Polar, priced)");
  });

  await test.step("a member pays on Polar checkout and is let in", async () => {
    await buyer.page.goto(`/c/${slug}/membership`);
    await settle(buyer.page);
    await buyer.page.getByRole("button", { name: "Join for $29.00/month" }).click();
    await expect(buyer.page).toHaveURL(polarHost);
    await buyer.page.getByRole("button", { name: "Pay now" }).click();
    await expect(buyer.page).toHaveURL((url) => url.pathname === `/c/${slug}/membership`);
    await expect(buyer.page.getByText("You're in")).toBeVisible({ timeout: 30_000 });
    await expectAccessible(buyer.page, "membership (Polar member)");
  });

  await test.step("the platform fee accrues for monthly billing", async () => {
    const rows = await query(
      `select l.kind, l.provider, l.collection_method, l.base_minor, l.computed_fee_minor
         from fee_ledger_entries l join communities c on c.id = l.community_id
        where c.slug = '${slug}'`,
    );
    expect(rows).toEqual([["fee_accrued", "polar", "periodic_invoice", "2900", "58"]]);
  });

  await test.step("the member cancels in the Polar portal and keeps access until the end", async () => {
    await buyer.page.getByRole("button", { name: "Manage billing" }).click();
    await expect(buyer.page).toHaveURL(polarHost);
    await buyer.page.getByRole("button", { name: "Cancel at period end" }).click();
    await expect(buyer.page).toHaveURL((url) => url.pathname === `/c/${slug}/membership`);
    await expect(async () => {
      await buyer.page.reload();
      await expect(buyer.page.getByText(/^Access until /).first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expectAccessible(buyer.page, "membership (Polar, canceling)");
  });
});
