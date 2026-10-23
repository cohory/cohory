import type { Page } from "@playwright/test";

import { expectAccessible } from "../support/axe";
import { query, serviceLogs } from "../support/db";
import { expect, test } from "../support/fixtures";
import { payingMember } from "../support/paid-member";
import { uniqueSuffix } from "../support/people";
import { failStripe, purchaseIds, stripeCalls } from "../support/stripe";
import { createCommunity } from "../pages/community";
import { settle } from "../pages/feed";
import { connectStripeAndSavePlan, openArchiveDialog } from "../pages/manage";

const poll = { timeout: 300_000, intervals: [2_000, 5_000] };

async function deleteRunStatus(communityId: string): Promise<string | null> {
  const [row] = await query(
    `select status from payment_exit_runs where community_id = '${communityId}' and kind = 'delete' order by created_at desc limit 1`,
  );
  return row?.[0] ?? null;
}

async function communityExists(communityId: string): Promise<boolean> {
  const [row] = await query(`select count(*) from communities where id = '${communityId}'`);
  return row?.[0] === "1";
}

async function openDeleteDialog(page: Page, slug: string) {
  await page.goto(`/c/${slug}/manage/settings/danger-zone`);
  await settle(page);
  await page.getByRole("button", { name: "Delete community" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /^Delete .+ for good\?$/ })).toBeVisible();
  return dialog;
}

test("deleting a paid community cancels subscriptions first and survives a Stripe failure", async ({
  actor,
  baseURL,
}) => {
  test.slow();
  const origin = baseURL ?? "";
  const owner = await actor("Hana", { desktop: true });
  const member = await actor("Theo");
  const name = `Closing for good ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "public");
  const account = await connectStripeAndSavePlan(owner.page, slug);
  const purchase = await payingMember(member.page, slug, account, origin);
  const ids = purchaseIds(purchase);
  const subscriptionPath = `/v1/subscriptions/${ids.subscription}`;

  await test.step("the owner archives and keeps billing", async () => {
    const archive = await openArchiveDialog(owner.page, slug);
    await archive.dialog.getByText("Keep billing", { exact: true }).click();
    await archive.confirm();
  });

  const clearFailure = await failStripe({ method: "DELETE", path: subscriptionPath, times: 50 });
  try {
    await test.step("the delete dialog counts the paying member", async () => {
      const dialog = await openDeleteDialog(owner.page, slug);
      await expect(
        dialog.getByText(
          "1 paying member. Their subscriptions are cancelled now and they are not charged again.",
        ),
      ).toBeVisible();
      await expectAccessible(owner.page, "delete dialog (paying members)");
      await dialog.getByLabel(`Type ${name} to confirm`).fill(name);
      await dialog.getByRole("button", { name: "Delete community" }).click();
      await expect(dialog).toBeHidden();
      await expect(owner.page.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    });

    await test.step("a cancel that keeps failing leaves the community archived", async () => {
      await expect.poll(() => deleteRunStatus(purchase.communityId), poll).toBe("running");
      await query(
        `update payment_exit_runs set attempts = 7 where community_id = '${purchase.communityId}' and kind = 'delete' and status = 'running'`,
      );
      await expect.poll(() => deleteRunStatus(purchase.communityId), poll).toBe("failed");
      expect(await communityExists(purchase.communityId)).toBe(true);
      await owner.page.reload();
      await expect(
        owner.page.getByText(
          "We could not cancel 1 subscription. Try again or cancel them in your Stripe Dashboard.",
        ),
      ).toBeVisible();
      await expect(owner.page.getByRole("button", { name: "Try again" })).toBeVisible();
      await expectAccessible(owner.page, "danger zone (delete failed)");
      const stillOpen = await member.page.goto(`/c/${slug}`);
      expect(stillOpen?.status()).toBe(200);
    });
  } finally {
    await clearFailure();
  }

  await test.step("Try again cancels without proration and deletes the community", async () => {
    await owner.page.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => communityExists(purchase.communityId), poll).toBe(false);
    const cancels = (await stripeCalls(account)).filter(
      (call) => call.method === "DELETE" && call.path === subscriptionPath,
    );
    expect(cancels.at(-1)).toEqual(
      expect.objectContaining({
        body: expect.objectContaining({ prorate: "false", invoice_now: "false" }),
        idempotencyKey: expect.stringMatching(/^exit:.+:cancel$/),
      }),
    );
  });

  await test.step("the member gets an email that the membership ended", async () => {
    await expect
      .poll(
        async () =>
          (await serviceLogs("worker")).includes(
            `to=${member.person.email} subject="[${name}] Your membership has ended"`,
          ),
        poll,
      )
      .toBe(true);
    const response = await member.page.goto(`/c/${slug}`);
    expect(response?.status()).toBe(404);
  });
});
