import type { Page } from "@playwright/test";

import { expectAccessible } from "../support/axe";
import { query, userIdOf } from "../support/db";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, expectNoHorizontalScroll } from "../pages/community";

async function seedBilling(slug: string): Promise<string> {
  const [community] = await query(`select id from communities where slug = '${slug}'`);
  const communityId = community?.[0] ?? "";
  expect(communityId, "community id").toBeTruthy();
  await query(`
    with account as (
      insert into platform_billing_accounts (id, community_id, billing_email)
      values (gen_random_uuid(), '${communityId}', 'billing-${slug}@example.test')
      returning id
    )
    insert into platform_invoices
      (id, community_id, billing_account_id, currency, period_start, period_end, amount_minor,
       amount_paid_minor, status, collection_method, invoice_number, hosted_invoice_url, due_at,
       finalized_at, paid_at, past_due_since)
    select gen_random_uuid(), '${communityId}'::uuid, account.id, 'usd', '2026-08-01Z'::timestamptz,
           '2026-09-01Z'::timestamptz, 2468, 0, 'open'::platform_invoice_status,
           'send_invoice'::platform_invoice_collection, 'E2E-0001', 'https://invoice.stripe.test/i/open', now() - interval '5 days',
           now() - interval '35 days', null::timestamptz, now() - interval '5 days'
      from account
    union all
    select gen_random_uuid(), '${communityId}'::uuid, account.id, 'usd', '2026-09-01Z'::timestamptz,
           '2026-10-01Z'::timestamptz, 1234, 1234, 'paid'::platform_invoice_status,
           'charge_automatically'::platform_invoice_collection, 'E2E-0002', 'https://invoice.stripe.test/i/paid', null::timestamptz,
           now() - interval '4 days', now() - interval '4 days', null::timestamptz
      from account`);
  await query(`
    insert into fee_ledger_entries
      (id, community_id, kind, provider, collection_method, currency, base_minor, rate_bps,
       computed_fee_minor, external_ref, idempotency_key, occurred_at)
    values (gen_random_uuid(), '${communityId}', 'fee_accrued', 'polar', 'periodic_invoice', 'usd',
            45600, 100, 456, 'order_e2e_${slug}', 'e2e:accrued:${slug}', now())`);
  return communityId;
}

async function addRole(communityId: string, email: string, role: "admin" | "member") {
  const userId = await userIdOf(email);
  await query(`
    insert into memberships (id, community_id, user_id, role, status, joined_at)
    values (gen_random_uuid(), '${communityId}', '${userId}', '${role}', 'active', now())`);
}

async function expectFeesPage(page: Page, slug: string): Promise<void> {
  await page.goto(`/c/${slug}/manage/payments/platform-fees`);
  await expect(page.getByRole("heading", { name: "Platform fees", exact: true })).toBeVisible();
  const usd = page.getByRole("listitem", { name: "USD platform fees" });
  await expect(usd.getByText("$4.56")).toBeVisible();
  const invoices = page.getByRole("table", { name: "Platform fee invoices" });
  const august = invoices.getByRole("row").filter({ hasText: "August 2026" });
  await expect(august.getByText("$24.68")).toBeVisible();
  await expect(august.getByText("Past due", { exact: true })).toBeVisible();
  await expect(august.getByRole("link", { name: /^Pay the August 2026 invoice/ })).toBeVisible();
  const september = invoices.getByRole("row").filter({ hasText: "September 2026" });
  await expect(september.getByText("$12.34")).toBeVisible();
  await expect(september.getByText("Paid", { exact: true })).toBeVisible();
  await expect(page.getByText("Payment failed").first()).toBeVisible();
}

test("the Platform fees page shows fees and invoices to the owner only", async ({ actor }) => {
  const owner = await actor("Fiona", { desktop: true });
  const phone = await actor("Fiona phone", { mobile: true, signedIn: false });
  const admin = await actor("Adam", { desktop: true });
  const member = await actor("Mia", { desktop: true });
  const slug = await createCommunity(owner.page, `Fees ${uniqueSuffix()}`, "private");
  const communityId = await seedBilling(slug);
  await addRole(communityId, admin.person.email, "admin");
  await addRole(communityId, member.person.email, "member");

  await test.step("the owner sees balances, invoice history, and billing controls", async () => {
    await expectFeesPage(owner.page, slug);
    await expect(owner.page.getByRole("button", { name: "Add a card" })).toBeVisible();
    await expect(owner.page.getByLabel("Billing email")).toBeVisible();
    await expectAccessible(owner.page, "platform fees (owner)");
  });

  await test.step("on a 390 pixel phone the page fits and stays accessible", async () => {
    const cookies = await owner.context.cookies();
    await phone.context.addCookies(cookies);
    await expectFeesPage(phone.page, slug);
    await expectNoHorizontalScroll(phone.page);
    await expectAccessible(phone.page, "platform fees (owner, mobile)");
  });

  await test.step("an admin can read but not change billing details", async () => {
    await expectFeesPage(admin.page, slug);
    await expect(admin.page.getByText("Only the owner can change billing details.")).toBeVisible();
    await expect(admin.page.getByRole("button", { name: "Add a card" })).toHaveCount(0);
    await expect(admin.page.getByLabel("Billing email")).toHaveCount(0);
  });

  await test.step("a member cannot open the page", async () => {
    await member.page.goto(`/c/${slug}/manage/payments/platform-fees`);
    await expect(member.page.getByRole("heading", { name: "Platform fees" })).toHaveCount(0);
    await expect(member.page.getByText("$24.68")).toHaveCount(0);
  });
});
