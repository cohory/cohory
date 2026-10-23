import { expectAccessible } from "../support/axe";
import { query, userIdOf } from "../support/db";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, expectNoHorizontalScroll } from "../pages/community";
import { settle } from "../pages/feed";

const sections = ["Overview", "Inbox", "People", "Payments", "Appearance", "Settings", "Migration"];

async function makeAdmin(slug: string, email: string): Promise<void> {
  const [community] = await query(`select id from communities where slug = '${slug}'`);
  const userId = await userIdOf(email);
  await query(`
    insert into memberships (id, community_id, user_id, role, status, joined_at)
    values (gen_random_uuid(), '${community?.[0] ?? ""}', '${userId}', 'admin', 'active', now())`);
}

test("step 16: Migration is its own Manage section, with export and import for the owner only", async ({
  actor,
}) => {
  const owner = await actor("Mira", { mobile: true });
  const admin = await actor("Abel", { desktop: true });
  const slug = await createCommunity(owner.page, `Moves ${uniqueSuffix()}`, "private");
  await makeAdmin(slug, admin.person.email);

  await test.step("the owner opens Migration from the Manage navigation at 390 wide", async () => {
    await owner.page.goto(`/c/${slug}/manage`);
    await settle(owner.page);
    const nav = owner.page.getByRole("navigation", { name: "Manage sections" });
    expect((await nav.getByRole("link").allInnerTexts()).map((text) => text.trim())).toEqual(
      sections,
    );
    await nav.getByRole("link", { name: "Migration" }).click();
    await expect(owner.page).toHaveURL((url) => url.pathname === `/c/${slug}/manage/migration`);
    await expect(nav.getByRole("link", { name: "Migration" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(owner.page.getByRole("heading", { name: "Migration", exact: true })).toBeVisible();
    await expect(owner.page.getByRole("button", { name: "Start export" })).toBeVisible();
    await expect(owner.page.getByText("Import members from a spreadsheet").first()).toBeVisible();
    await expect(owner.page.getByText("Bring your existing subscribers").first()).toBeVisible();
    const headings = (await owner.page.getByRole("main").getByRole("heading").allInnerTexts()).map(
      (text) => text.trim(),
    );
    const order = [
      "Import from another platform",
      "Import members from a spreadsheet",
      "Bring your existing subscribers",
      "Cohory archives",
      "Export archive",
      "Import archive",
    ].map((name) => headings.indexOf(name));
    expect(
      order.every((index) => index >= 0),
      `headings: ${headings.join(", ")}`,
    ).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    await settle(owner.page);
    await expectNoHorizontalScroll(owner.page);
    await expectAccessible(owner.page, "manage migration (owner, 390 wide)");
  });

  await test.step("the old Settings URLs redirect to the new section", async () => {
    await owner.page.goto(`/c/${slug}/manage/settings/migration`);
    await expect(owner.page).toHaveURL((url) => url.pathname === `/c/${slug}/manage/migration`);
    await owner.page.goto(`/c/${slug}/manage/settings/migration/subscribers`);
    await expect(owner.page).toHaveURL(
      (url) => url.pathname === `/c/${slug}/manage/migration/subscribers`,
    );
    await expect(
      owner.page.getByRole("heading", { name: "Bring your existing subscribers" }),
    ).toBeVisible();
    await expect(owner.page.getByRole("link", { name: "Back to Migration" })).toBeVisible();
  });

  await test.step("an admin sees only the subscribers part", async () => {
    await admin.page.goto(`/c/${slug}/manage/migration`);
    await settle(admin.page);
    await expect(admin.page.getByRole("heading", { name: "Migration", exact: true })).toBeVisible();
    await expect(admin.page.getByText("Bring your existing subscribers").first()).toBeVisible();
    await expect(admin.page.getByText("is for the owner")).toBeVisible();
    await expect(admin.page.getByRole("button", { name: "Start export" })).toHaveCount(0);
    await expectAccessible(admin.page, "manage migration (admin)");
  });

  await test.step("Settings no longer holds a Migration card", async () => {
    await owner.page.goto(`/c/${slug}/manage/settings`);
    await settle(owner.page);
    await expect(owner.page.getByRole("link", { name: "Open Migration" })).toHaveCount(0);
  });
});
