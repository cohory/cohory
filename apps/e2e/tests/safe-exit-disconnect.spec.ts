import type { Page } from "@playwright/test";

import { expectAccessible } from "../support/axe";
import { query, serviceLogs } from "../support/db";
import { expect, test } from "../support/fixtures";
import { endDate, payingMember } from "../support/paid-member";
import { uniqueSuffix } from "../support/people";
import {
  allStripeCalls,
  failStripe,
  purchaseIds,
  putStripeObjects,
  deliverWebhook,
  stripeCalls,
  type Purchase,
  type StripeCall,
} from "../support/stripe";
import { createCommunity } from "../pages/community";
import { bell } from "../pages/feed";
import { connectStripeAndSavePlan, openDisconnectDialog } from "../pages/manage";

const poll = { timeout: 120_000, intervals: [1_000, 2_000, 5_000] };

function subscriptionWrites(calls: readonly StripeCall[], purchase: Purchase): StripeCall[] {
  const { subscription } = purchaseIds(purchase);
  return calls.filter(
    (call) => call.method === "POST" && call.path === `/v1/subscriptions/${subscription}`,
  );
}

async function connectionStatus(communityId: string): Promise<string | null> {
  const [row] = await query(
    `select status from payment_connections where community_id = '${communityId}' order by created_at desc limit 1`,
  );
  return row?.[0] ?? null;
}

async function waitForDisconnected(page: Page, slug: string, communityId: string): Promise<void> {
  await expect.poll(() => connectionStatus(communityId), poll).toBe("disconnected");
  await page.goto(`/c/${slug}/manage/payments`);
  await expect(page.getByRole("button", { name: "Connect your Stripe account" })).toBeVisible();
}

async function memberNotice(page: Page, slug: string, text: string): Promise<void> {
  await expect(async () => {
    await page.goto(`/c/${slug}`);
    await expect(bell(page)).toHaveAttribute("aria-label", "Notifications, 1 unread", {
      timeout: 2_000,
    });
  }).toPass({ timeout: 150_000, intervals: [2_000, 5_000] });
  await bell(page).click();
  await expect(page.getByText(text, { exact: false })).toBeVisible();
}

async function emailLogged(to: string, subject: string): Promise<void> {
  await expect
    .poll(async () => (await serviceLogs("worker")).includes(`to=${to} subject="${subject}"`), poll)
    .toBe(true);
}

test("an owner disconnects and takes paying members along without the fee", async ({
  actor,
  baseURL,
}) => {
  test.slow();
  const origin = baseURL ?? "";
  const owner = await actor("Dora", { desktop: true });
  const member = await actor("Milo");
  const name = `Leaving ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "public");
  const account = await connectStripeAndSavePlan(owner.page, slug);
  const purchase = await payingMember(member.page, slug, account, origin);
  const ids = purchaseIds(purchase);
  const portalLink = `https://billing.stripe.com/p/login/test_${uniqueSuffix()}`;

  await test.step("the dialog counts the paying member and takes them along by default", async () => {
    const dialog = await openDisconnectDialog(owner.page, slug);
    await expect(dialog.getByText("1 paying member.")).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Take my members with me" })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "Wind down" })).not.toBeChecked();
    await dialog
      .getByLabel("Stripe customer portal link (optional)")
      .fill("https://evil.test/p/login/x");
    await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(
      dialog.getByText("Paste your Stripe customer portal link from billing.stripe.com"),
    ).toBeVisible();
    await expectAccessible(owner.page, "disconnect dialog (paying members)");
    await dialog.getByLabel("Stripe customer portal link (optional)").fill(portalLink);
    await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step("the fee is removed from the subscription before the connection closes", async () => {
    await waitForDisconnected(owner.page, slug, purchase.communityId);
    const writes = subscriptionWrites(await stripeCalls(account), purchase);
    expect(writes).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({ application_fee_percent: "" }),
        idempotencyKey: expect.stringMatching(new RegExp(`^disconnect:.+:${ids.subscription}$`)),
      }),
    ]);
    const [run] = await query(
      `select kind, choice, status from payment_exit_runs where community_id = '${purchase.communityId}'`,
    );
    expect(run).toEqual(["disconnect", "take_members", "done"]);
  });

  const sentence = `Your membership is now billed directly by ${name}. To change or cancel it, use the link in your Stripe receipt emails or contact ${owner.person.email}.`;

  await test.step("the member is told the creator bills them now", async () => {
    await memberNotice(member.page, slug, sentence);
    await emailLogged(member.person.email, `[${name}] Your membership is now billed by ${name}`);
    await member.page.goto(`/c/${slug}/membership`);
    await expect(member.page.getByText(/ per month\. Next payment /)).toBeVisible();
  });

  await test.step("a platform fee that arrives afterwards is refunded", async () => {
    await putStripeObjects({
      application_fees: {
        [ids.fee]: {
          id: ids.fee,
          object: "application_fee",
          account,
          charge: ids.charge,
          amount: 58,
          amount_refunded: 0,
          currency: "usd",
          created: Math.floor(Date.now() / 1000),
          refunded: false,
          refunds: { object: "list", data: [], has_more: false },
        },
      },
    });
    await deliverWebhook(
      origin,
      "application_fee.created",
      { id: ids.fee, object: "application_fee", account },
      { id: `evt_e2e_exitfee_${uniqueSuffix()}` },
    );
    const refunds = (await allStripeCalls()).filter(
      (call) => call.method === "POST" && call.path === `/v1/application_fees/${ids.fee}/refunds`,
    );
    expect(refunds).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({ amount: "58" }),
        idempotencyKey: `exit-fee-refund:${ids.fee}`,
      }),
    ]);
  });

  await test.step("paid access ends at the stored period end", async () => {
    await query(
      `update subscriptions set current_period_end = now() - interval '1 day' where external_subscription_id = '${ids.subscription}'`,
    );
    await member.page.goto(`/c/${slug}/membership`);
    await expect(
      member.page.getByText(
        `Your paid access to ${name} ended. Join again from the community page, or contact ${owner.person.email}.`,
      ),
    ).toBeVisible();
    await expectAccessible(member.page, "membership (paid access ended)");
  });
});

test("a fee that cannot be removed keeps the connection disconnecting until the owner disconnects anyway", async ({
  actor,
  baseURL,
}) => {
  test.slow();
  const origin = baseURL ?? "";
  const owner = await actor("Petra", { desktop: true });
  const member = await actor("Noah");
  const visitor = await actor("Ivy");
  const name = `Stuck ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "public");
  const account = await connectStripeAndSavePlan(owner.page, slug);
  const purchase = await payingMember(member.page, slug, account, origin);
  const ids = purchaseIds(purchase);
  const clearFailure = await failStripe({
    method: "POST",
    path: `/v1/subscriptions/${ids.subscription}`,
    times: 50,
  });

  try {
    await test.step("the connection stays disconnecting and checkouts are closed", async () => {
      const dialog = await openDisconnectDialog(owner.page, slug);
      await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect
        .poll(
          async () =>
            (
              await query(
                `select array_length(failed_subscription_ids, 1) from payment_exit_runs where community_id = '${purchase.communityId}'`,
              )
            )[0]?.[0] ?? null,
          poll,
        )
        .toBe("1");
      expect(await connectionStatus(purchase.communityId)).toBe("disconnecting");
      await owner.page.reload();
      await expect(owner.page.getByText("Disconnecting", { exact: true })).toBeVisible();
      await expect(owner.page.getByText("Disconnecting Stripe")).toBeVisible();
      const checkout = await visitor.context.request.post(
        `/api/v1/communities/${purchase.communityId}/payments/checkout`,
        { headers: { origin }, data: {} },
      );
      expect(checkout.status()).toBe(409);
      expect(await checkout.json()).toMatchObject({ error: { code: "not_connected" } });
    });

    await test.step("after the last retry the owner sees who failed", async () => {
      await query(
        `update payment_exit_runs set attempts = 7 where community_id = '${purchase.communityId}' and status = 'running'`,
      );
      await expect
        .poll(
          async () =>
            (
              await query(
                `select status from payment_exit_runs where community_id = '${purchase.communityId}'`,
              )
            )[0]?.[0] ?? null,
          { timeout: 300_000, intervals: [2_000, 5_000] },
        )
        .toBe("failed");
      await owner.page.reload();
      await expect(
        owner.page.getByText("We could not remove the Cohory fee from 1 subscription"),
      ).toBeVisible();
      await expect(
        owner.page.getByRole("listitem").filter({ hasText: member.person.name }),
      ).toBeVisible();
      await expect(owner.page.getByRole("button", { name: "Try again" })).toBeVisible();
      await expectAccessible(owner.page, "payments (disconnect failed)");
    });

    await test.step("Disconnect anyway closes it and tells the owner to clear the fee", async () => {
      await owner.page.getByRole("button", { name: "Disconnect anyway" }).click();
      const confirm = owner.page.getByRole("dialog");
      await expect(
        confirm.getByText("1 subscription may still carry the Cohory fee", { exact: false }),
      ).toBeVisible();
      await confirm.getByRole("button", { name: "Disconnect anyway" }).click();
      await expect(confirm).toBeHidden();
      await waitForDisconnected(owner.page, slug, purchase.communityId);
      await emailLogged(
        owner.person.email,
        `[${name}] Remove the Cohory fee in your Stripe Dashboard`,
      );
      await memberNotice(member.page, slug, `Your membership is now billed directly by ${name}.`);
    });
  } finally {
    await clearFailure();
  }
});

test("wind down sets every subscription to end at the period end", async ({ actor, baseURL }) => {
  test.slow();
  const origin = baseURL ?? "";
  const owner = await actor("Rita", { desktop: true });
  const member = await actor("Sami");
  const name = `Closing ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "public");
  const account = await connectStripeAndSavePlan(owner.page, slug);
  const purchase = await payingMember(member.page, slug, account, origin);

  const dialog = await openDisconnectDialog(owner.page, slug);
  await dialog.getByText("Wind down", { exact: true }).click();
  await expect(dialog.getByLabel("Stripe customer portal link (optional)")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(dialog).toBeHidden();
  await waitForDisconnected(owner.page, slug, purchase.communityId);

  const writes = subscriptionWrites(await stripeCalls(account), purchase);
  expect(writes.map((call) => call.body)).toEqual([
    expect.objectContaining({ application_fee_percent: "" }),
    expect.objectContaining({ cancel_at_period_end: "true" }),
  ]);
  expect(writes[1]?.idempotencyKey).toMatch(new RegExp(`^exit:.+:period-end$`));
  await memberNotice(
    member.page,
    slug,
    `${name} has stopped selling memberships through Cohory. Your subscription ends on ${endDate(purchase.periodEnd)} and will not renew.`,
  );
});
