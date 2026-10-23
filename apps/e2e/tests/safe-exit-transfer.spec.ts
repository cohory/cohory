import type { Page } from "@playwright/test";

import { expectAccessible } from "../support/axe";
import { query } from "../support/db";
import { expect, test } from "../support/fixtures";
import { buyMembership, payingMember } from "../support/paid-member";
import { uniqueSuffix } from "../support/people";
import { purchaseIds, stripeCalls } from "../support/stripe";
import { createCommunity, joinCommunity } from "../pages/community";
import { bell, settle } from "../pages/feed";
import { connectStripeAndSavePlan } from "../pages/manage";

const poll = { timeout: 120_000, intervals: [1_000, 2_000, 5_000] };
const reviewTitle = "Choose a Stripe account for payments";

async function transferTo(page: Page, slug: string, name: string, heir: string): Promise<void> {
  await page.goto(`/c/${slug}/manage/settings/danger-zone`);
  await settle(page);
  await page.getByLabel("New owner").selectOption({ label: heir });
  await page.getByRole("button", { name: "Transfer ownership" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: `Make ${heir} the owner?` })).toBeVisible();
  await expect(
    dialog.getByText(
      `Your Stripe account stays connected, and new checkouts pause until ${heir} keeps it or connects their own.`,
      { exact: false },
    ),
  ).toBeVisible();
  await dialog.getByLabel(`Type ${name} to confirm`).fill(name);
  await dialog.getByRole("button", { name: "Transfer ownership" }).click();
  await expect(dialog).toBeHidden();
}

async function noticeShows(page: Page, slug: string, text: string): Promise<void> {
  await expect(async () => {
    await page.goto(`/c/${slug}`);
    await expect(bell(page)).toHaveAttribute("aria-label", /^Notifications, \d+ unread$/, {
      timeout: 2_000,
    });
  }).toPass({ timeout: 150_000, intervals: [2_000, 5_000] });
  await bell(page).click();
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
  await page.keyboard.press("Escape");
}

async function connectionStatus(communityId: string): Promise<string | null> {
  const [row] = await query(
    `select status from payment_connections where community_id = '${communityId}' order by created_at desc limit 1`,
  );
  return row?.[0] ?? null;
}

test("a new owner keeps the previous Stripe account and checkouts resume", async ({
  actor,
  baseURL,
}) => {
  test.slow();
  const origin = baseURL ?? "";
  const owner = await actor("Petra", { desktop: true });
  const heir = await actor("Nadia", { desktop: true });
  const member = await actor("Oskar");
  const buyer = await actor("Rhea");
  const name = `Handing over ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "public");
  await joinCommunity(heir.page, slug);
  const account = await connectStripeAndSavePlan(owner.page, slug);
  await payingMember(member.page, slug, account, origin);

  await test.step("the owner transfers and is told checkouts pause", async () => {
    await transferTo(owner.page, slug, name, heir.person.name);
  });

  await test.step("the previous and the new owner both get a notice", async () => {
    const text = `${name} has a new owner. If it sells memberships, new checkouts pause until the new owner chooses a Stripe account in Manage, Payments.`;
    await noticeShows(owner.page, slug, text);
    await noticeShows(heir.page, slug, text);
  });

  await test.step("nobody can buy while the new owner has not chosen", async () => {
    await buyer.page.goto(`/c/${slug}/membership`);
    await settle(buyer.page);
    await expect(
      buyer.page.getByText("The creator hasn't finished setting up payments. Try again later."),
    ).toBeVisible();
    await expect(buyer.page.getByRole("button", { name: /^Join for/ })).toHaveCount(0);
  });

  await test.step("the new owner keeps the previous owner's account", async () => {
    await heir.page.goto(`/c/${slug}/manage/payments`);
    await settle(heir.page);
    await expect(heir.page.getByText(reviewTitle)).toBeVisible();
    await expect(
      heir.page.getByText("1 paying member is billed on it.", { exact: false }),
    ).toBeVisible();
    await expectAccessible(heir.page, "payments (ownership review)");
    await heir.page
      .getByRole("button", { name: "The previous owner's Stripe account keeps receiving payments" })
      .click();
    await expect(heir.page.getByText(reviewTitle)).toBeHidden();
  });

  await test.step("checkouts resume on the same account with the same fee", async () => {
    const before = (await stripeCalls(account)).length;
    await buyMembership(buyer.page, slug, account);
    const checkout = (await stripeCalls(account))
      .slice(before)
      .find((call) => call.path === "/v1/checkout/sessions");
    expect(checkout?.body["subscription_data[application_fee_percent]"]).toBe("2");
  });
});

test("a new owner connects their own account after closing the previous one", async ({
  actor,
  baseURL,
}) => {
  test.slow();
  const origin = baseURL ?? "";
  const owner = await actor("Ines", { desktop: true });
  const heir = await actor("Jonas", { desktop: true });
  const member = await actor("Kemal");
  const name = `New hands ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "public");
  await joinCommunity(heir.page, slug);
  const account = await connectStripeAndSavePlan(owner.page, slug);
  const purchase = await payingMember(member.page, slug, account, origin);
  const { subscription } = purchaseIds(purchase);
  await transferTo(owner.page, slug, name, heir.person.name);

  await test.step("connecting a new account first runs the disconnect choice", async () => {
    await heir.page.goto(`/c/${slug}/manage/payments`);
    await settle(heir.page);
    await heir.page.getByRole("button", { name: "Connect my own Stripe account" }).click();
    const dialog = heir.page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Connect your own Stripe account?" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("radio", { name: "Keep them billed on the previous owner's account" }),
    ).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "Wind down" })).toBeVisible();
    await expect(dialog.getByLabel("Stripe customer portal link (optional)")).toHaveCount(0);
    await expectAccessible(heir.page, "connect my own account dialog");
    await dialog.getByRole("button", { name: "Close the previous account" }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step("the old connection closes without the fee and the new owner can connect", async () => {
    await expect.poll(() => connectionStatus(purchase.communityId), poll).toBe("disconnected");
    const feeCleared = (await stripeCalls(account)).some(
      (call) =>
        call.method === "POST" &&
        call.path === `/v1/subscriptions/${subscription}` &&
        call.body["application_fee_percent"] === "",
    );
    expect(feeCleared).toBe(true);
    await heir.page.goto(`/c/${slug}/manage/payments`);
    await expect(
      heir.page.getByRole("button", { name: "Connect your Stripe account" }),
    ).toBeVisible();
  });

  await test.step("the paying member is told who bills them now", async () => {
    await noticeShows(
      member.page,
      slug,
      `Your membership is now billed directly by ${name}. To change or cancel it, use the link in your Stripe receipt emails or contact ${owner.person.email}.`,
    );
  });
});
