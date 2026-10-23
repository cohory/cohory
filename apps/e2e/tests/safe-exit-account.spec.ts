import { expectAccessible } from "../support/axe";
import { query } from "../support/db";
import { expect, test } from "../support/fixtures";
import { endDate, payingMember } from "../support/paid-member";
import { uniqueSuffix } from "../support/people";
import { settle } from "../pages/feed";
import { createCommunity } from "../pages/community";
import { connectStripeAndSavePlan, openDisconnectDialog } from "../pages/manage";

const poll = { timeout: 120_000, intervals: [1_000, 2_000, 5_000] };

async function connectionStatus(communityId: string): Promise<string | null> {
  const [row] = await query(
    `select status from payment_connections where community_id = '${communityId}' order by created_at desc limit 1`,
  );
  return row?.[0] ?? null;
}

test("a member sees every paid membership on Account, Billing", async ({ actor, baseURL }) => {
  test.slow();
  const origin = baseURL ?? "";
  const owner = await actor("Vera", { desktop: true });
  const member = await actor("Ezra");
  const name = `Pottery guild ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "public");
  const account = await connectStripeAndSavePlan(owner.page, slug);
  const purchase = await payingMember(member.page, slug, account, origin);
  const row = member.page.getByRole("listitem").filter({ hasText: name });

  await test.step("the row shows the plan, the price, and the next charge", async () => {
    await member.page.goto("/account/billing");
    await settle(member.page);
    await expect(member.page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
    await expect(row).toContainText("$29.00/month");
    await expect(row).toContainText("Active");
    await expect(row).toContainText(`Next charge on ${endDate(purchase.periodEnd)}`);
    await expectAccessible(member.page, "account billing");
  });

  await test.step("Manage billing opens the Stripe customer portal", async () => {
    await row.getByRole("button", { name: "Manage billing" }).click();
    await expect(member.page).toHaveURL(/^https:\/\/billing\.stripe\.test\//);
  });

  await test.step("after a disconnect the creator bills the member directly", async () => {
    const dialog = await openDisconnectDialog(owner.page, slug);
    await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => connectionStatus(purchase.communityId), poll).toBe("disconnected");

    await member.page.goto("/account/billing");
    await settle(member.page);
    await expect(row).toContainText(`Billed directly by ${name}`);
    await expect(row).toContainText(`Ends on ${endDate(purchase.periodEnd)}`);
    await expect(row.getByRole("link", { name: owner.person.email })).toHaveAttribute(
      "href",
      `mailto:${owner.person.email}`,
    );
    await expect(row.getByRole("button", { name: "Manage billing" })).toHaveCount(0);
    await expectAccessible(member.page, "account billing (billed directly)");
  });

  await test.step("a person with no paid memberships sees an empty page", async () => {
    await owner.page.goto("/account/billing");
    await settle(owner.page);
    await expect(owner.page.getByText(/^You have no paid memberships\./)).toBeVisible();
  });
});
