import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { endDate, payingMember } from "../support/paid-member";
import { uniqueSuffix } from "../support/people";
import { purchaseIds, stripeCalls } from "../support/stripe";
import { createCommunity } from "../pages/community";
import { bell } from "../pages/feed";
import { connectStripeAndSavePlan, openArchiveDialog, openRestoreDialog } from "../pages/manage";

test("an owner archives a paid community and members stop at period end", async ({
  actor,
  baseURL,
}) => {
  test.slow();
  const origin = baseURL ?? "";
  const owner = await actor("Olga", { desktop: true });
  const member = await actor("Ben");
  const visitor = await actor("Vera");
  const slug = await createCommunity(owner.page, `Closing ${uniqueSuffix()}`, "public");
  const account = await connectStripeAndSavePlan(owner.page, slug);

  const purchase = await test.step("a member pays for the membership", async () => {
    const bought = await payingMember(member.page, slug, account, origin);
    await member.page.goto(`/c/${slug}/membership`);
    await expect(member.page.getByText(/ per month\. Next payment /)).toBeVisible({
      timeout: 30_000,
    });
    return bought;
  });
  const ids = purchaseIds(purchase);

  await test.step("the archive dialog counts the paying member and stops at period end by default", async () => {
    const archive = await openArchiveDialog(owner.page, slug);
    await expect(archive.dialog.getByText("1 paying member.")).toBeVisible();
    await expect(archive.dialog.getByRole("radio", { name: "Stop at period end" })).toBeChecked();
    await expect(archive.dialog.getByRole("radio", { name: "Keep billing" })).not.toBeChecked();
    await expectAccessible(owner.page, "archive dialog (paying members)");
    await archive.confirm();
  });

  await test.step("Stripe gets cancel at period end with one key per subscription", async () => {
    await expect
      .poll(
        async () =>
          (await stripeCalls(account)).filter(
            (call) =>
              call.method === "POST" &&
              call.path === `/v1/subscriptions/${ids.subscription}` &&
              call.body["cancel_at_period_end"] === "true",
          ),
        { timeout: 90_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toEqual([
        expect.objectContaining({ idempotencyKey: expect.stringMatching(/^exit:.+:period-end$/) }),
      ]);
  });

  await test.step("the membership page takes no new members", async () => {
    await visitor.page.goto(`/c/${slug}/membership`);
    await expect(
      visitor.page.getByText("This community is archived, so new memberships are closed."),
    ).toBeVisible();
    await expect(visitor.page.getByRole("button", { name: /^Join for / })).toHaveCount(0);
    await expect(visitor.page.getByRole("button", { name: "Not available" })).toBeDisabled();
    const checkout = await visitor.context.request.post(
      `/api/v1/communities/${purchase.communityId}/payments/checkout`,
      { headers: { origin }, data: {} },
    );
    expect(checkout.status()).toBe(409);
    expect(await checkout.json()).toMatchObject({ error: { code: "community_archived" } });
    await expectAccessible(visitor.page, "membership (archived community)");
  });

  await test.step("the member is told in the app when the subscription ends", async () => {
    await expect(async () => {
      await member.page.goto(`/c/${slug}`);
      await expect(bell(member.page)).toHaveAttribute("aria-label", "Notifications, 1 unread", {
        timeout: 2_000,
      });
    }).toPass({ timeout: 150_000, intervals: [2_000, 5_000] });
    await bell(member.page).click();
    await expect(
      member.page.getByText(
        `is archived. Your subscription ends on ${endDate(purchase.periodEnd)} and will not renew.`,
        { exact: false },
      ),
    ).toBeVisible();
  });

  await test.step("restoring shows how to keep subscriptions that are set to end", async () => {
    const dialog = await openRestoreDialog(owner.page, slug);
    await expect(
      dialog.getByText(
        "1 subscription is set to end. To keep them, turn renewal back on in your Stripe Dashboard.",
        { exact: false },
      ),
    ).toBeVisible();
    await expectAccessible(owner.page, "restore dialog (subscriptions ending)");
  });
});

test("an owner keeps billing on archive and can stop renewals later", async ({
  actor,
  baseURL,
}) => {
  test.slow();
  const origin = baseURL ?? "";
  const owner = await actor("Omar", { desktop: true });
  const member = await actor("Bea");
  const slug = await createCommunity(owner.page, `Resting ${uniqueSuffix()}`, "public");
  const account = await connectStripeAndSavePlan(owner.page, slug);
  const purchase = await payingMember(member.page, slug, account, origin);
  const ids = purchaseIds(purchase);

  const archive = await openArchiveDialog(owner.page, slug);
  await expect(archive.dialog.getByText("1 paying member.")).toBeVisible();
  await archive.dialog.getByText("Keep billing", { exact: true }).click();
  await archive.confirm();
  await expect(
    owner.page.getByText("1 paying member. Their subscriptions keep billing."),
  ).toBeVisible();
  expect(
    (await stripeCalls(account)).filter(
      (call) => call.path === `/v1/subscriptions/${ids.subscription}` && call.method === "POST",
    ),
  ).toEqual([]);

  await owner.page.getByRole("button", { name: "Stop renewals at period end" }).click();
  const dialog = owner.page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Stop renewals" }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await stripeCalls(account)).some(
          (call) =>
            call.path === `/v1/subscriptions/${ids.subscription}` &&
            call.body["cancel_at_period_end"] === "true",
        ),
      { timeout: 90_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(true);
});
