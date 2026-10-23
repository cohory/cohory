import { expectAccessible } from "../support/axe";
import { query } from "../support/db";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, joinCommunity } from "../pages/community";
import { settle } from "../pages/feed";
import { createInviteLink } from "../pages/manage";

test("an owner changes the community URL and every old link still works", async ({ actor }) => {
  const owner = await actor("Ines");
  const name = `Renamed ${uniqueSuffix()}`;
  const oldSlug = await createCommunity(owner.page, name, "public");
  const newSlug = `moved-${uniqueSuffix()}`.toLowerCase();
  const invite = await createInviteLink(owner.page, oldSlug);
  const admin = await actor("Ari");
  await joinCommunity(admin.page, oldSlug);
  await query(
    `update memberships set role = 'admin' where user_id = (select id from users where email = '${admin.person.email}') and community_id = (select id from communities where slug = '${oldSlug}')`,
  );

  await test.step("an admin sees the URL but cannot change it", async () => {
    await admin.page.goto(`/c/${oldSlug}/manage/settings`);
    const field = admin.page.getByLabel("Community URL");
    await expect(field).toHaveValue(oldSlug);
    await expect(field).toHaveAttribute("readonly", "");
    await expect(
      admin.page.getByText("Only the owner can change the community URL."),
    ).toBeVisible();
    await expect(admin.page.getByRole("button", { name: "Change URL" })).toHaveCount(0);
  });

  await test.step("the owner confirms the new URL and lands on it", async () => {
    await owner.page.goto(`/c/${oldSlug}/manage/settings`);
    await settle(owner.page);
    await owner.page.getByLabel("Community URL").fill(newSlug);
    await owner.page.getByRole("button", { name: "Change URL" }).click();
    const dialog = owner.page.getByRole("dialog");
    await expect(dialog.getByText(/shared invite links, keep working/)).toBeVisible();
    await expect(dialog.getByText(/again after 30 days/)).toBeVisible();
    await expectAccessible(owner.page, "change community URL dialog");
    await dialog.getByRole("button", { name: "Change URL" }).click();
    await expect(owner.page).toHaveURL((url) => url.pathname === `/c/${newSlug}/manage/settings`, {
      timeout: 30_000,
    });
    await expect(owner.page.getByLabel("Community URL")).toHaveValue(newSlug);
    await expect(owner.page.getByText(/You can change it again on /)).toBeVisible();
    await expect(owner.page.getByRole("button", { name: "Change URL" })).toHaveCount(0);
  });

  await test.step("the old URL answers a permanent redirect that keeps the path and query", async () => {
    const page = await owner.page.request.get(`/c/${oldSlug}/about?tab=reviews`, {
      maxRedirects: 0,
    });
    expect(page.status()).toBe(308);
    expect(page.headers().location).toBe(`/c/${newSlug}/about?tab=reviews`);
    const api = await owner.page.request.get(`/api/v1/communities/${oldSlug}/posts?limit=1`, {
      maxRedirects: 0,
    });
    expect(api.status()).toBe(308);
    expect(api.headers().location).toBe(`/api/v1/communities/${newSlug}/posts?limit=1`);
  });

  await test.step("a member following the old link reaches the new feed", async () => {
    await admin.page.goto(`/c/${oldSlug}`);
    await expect(admin.page).toHaveURL((url) => url.pathname === `/c/${newSlug}`);
    await expect(admin.page.getByRole("heading", { name }).first()).toBeVisible();
  });

  await test.step("a visitor following the old About link reaches the new About page", async () => {
    const visitor = await actor("Vera", { signedIn: false });
    await visitor.page.goto(`/c/${oldSlug}/about`);
    await expect(visitor.page).toHaveURL((url) => url.pathname === `/c/${newSlug}/about`);
    await expect(visitor.page.getByRole("heading", { name }).first()).toBeVisible();
  });

  await test.step("an invite link shared before the change still brings people in", async () => {
    const invited = await actor("Ivo");
    await invited.page.goto(invite);
    await expect(invited.page.getByText(`You're invited to ${name}`)).toBeVisible();
    await settle(invited.page);
    await invited.page.getByRole("button", { name: "Join community" }).click();
    await expect(invited.page).toHaveURL((url) => url.pathname === `/c/${newSlug}`, {
      timeout: 30_000,
    });
  });
});
