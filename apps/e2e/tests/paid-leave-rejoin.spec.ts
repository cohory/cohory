import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { payingMember } from "../support/paid-member";
import { uniqueSuffix } from "../support/people";
import { stripeCalls } from "../support/stripe";
import { settle } from "../pages/feed";
import { createCommunity } from "../pages/community";
import { connectStripeAndSavePlan } from "../pages/manage";

const portal = /^https:\/\/billing\.stripe\.test\//;

test("a paying member opens billing twice, leaves, and joins again without paying", async ({
  actor,
  baseURL,
}) => {
  test.slow();
  const origin = baseURL ?? "";
  const owner = await actor("Petra", { desktop: true });
  const member = await actor("Lior", { desktop: true });
  const name = `Glass studio ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "public");
  const account = await connectStripeAndSavePlan(owner.page, slug);
  await payingMember(member.page, slug, account, origin);
  const checkouts = async () =>
    (await stripeCalls(account)).filter((call) => call.path === "/v1/checkout/sessions").length;
  const row = member.page.getByRole("listitem").filter({ hasText: name });

  await test.step("Manage billing works from both pages back to back", async () => {
    await member.page.goto(`/c/${slug}/membership`);
    await settle(member.page);
    await member.page.getByRole("button", { name: "Manage billing" }).click();
    await expect(member.page).toHaveURL(portal);

    await member.page.goto("/account/billing");
    await settle(member.page);
    await row.getByRole("button", { name: "Manage billing" }).click();
    await expect(member.page).toHaveURL(portal);

    await member.page.goto(`/c/${slug}/membership`);
    await settle(member.page);
    await member.page.getByRole("button", { name: "Manage billing" }).click();
    await expect(member.page).toHaveURL(portal);
  });

  await test.step("the Leave dialog says the paid membership keeps running", async () => {
    await member.page.goto(`/c/${slug}`);
    await settle(member.page);
    await member.page.getByRole("button", { name: "More community options" }).click();
    await member.page.getByRole("menuitem", { name: "Leave community" }).click();
    const dialog = member.page.getByRole("dialog");
    await expect(dialog).toContainText("Leaving doesn't cancel your paid membership.");
    await expect(dialog.getByRole("link", { name: "cancel it in Billing" })).toHaveAttribute(
      "href",
      "/account/billing",
    );
    await expectAccessible(member.page, "leave dialog (paying member)");
    await dialog.getByRole("button", { name: "Leave community" }).click();
    await expect(member.page.getByRole("button", { name: "More community options" })).toHaveCount(
      0,
    );
  });

  await test.step("Billing in the account still lists the subscription", async () => {
    await member.page.goto("/account/billing");
    await settle(member.page);
    await expect(row).toContainText("Active");
  });

  await test.step("Join again restores the membership without a checkout", async () => {
    const before = await checkouts();
    await member.page.goto(`/c/${slug}/membership`);
    await settle(member.page);
    await expect(member.page.getByText(`You left ${name}`)).toBeVisible();
    await expectAccessible(member.page, "membership (left with paid access)");

    await member.page.goto(`/c/${slug}`);
    await settle(member.page);
    const joinAgain = member.page.getByRole("button", { name: "Join again" }).first();
    await expect(joinAgain).toBeVisible();
    await expectAccessible(member.page, "community (left with paid access)");
    await joinAgain.click();
    await expect(member.page.getByRole("button", { name: "More community options" })).toBeVisible();
    expect(await checkouts()).toBe(before);
  });
});
