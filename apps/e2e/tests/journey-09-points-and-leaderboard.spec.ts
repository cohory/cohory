import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, joinCommunity } from "../pages/community";
import { setLiked, settle, writePost } from "../pages/feed";
import { expectPoints, memberCard } from "../pages/members";

test("journey 9: a member earns points and climbs the leaderboard", async ({ actor }) => {
  const author = await actor("Ada");
  const slug = await createCommunity(author.page, `Points ${uniqueSuffix()}`, "public");
  const firstPost = await writePost(author.page, slug, `First post ${uniqueSuffix()}`);
  const secondPost = await writePost(author.page, slug, `Second post ${uniqueSuffix()}`);
  const fan = await actor("Bea");
  await joinCommunity(fan.page, slug);
  const { page } = fan;

  await test.step("a like gives the author one point and level 1", async () => {
    await setLiked(page, firstPost, true);
    await expectPoints(page, slug, author.person.name, "1 point");
    await expect(
      memberCard(page, author.person.name).locator('[data-slot="level-badge"]').first(),
    ).toHaveAttribute("aria-label", /^Level 1/);
    await expectAccessible(page, "members directory");
  });

  await test.step("a second like makes two points and rank 1 this week", async () => {
    await setLiked(page, secondPost, true);
    await expectPoints(page, slug, author.person.name, "2 points");
    await page.goto(`/c/${slug}/members/leaderboard?window=7d`);
    const top = page.locator('ol[aria-label="Top members, 7 days"] li').first();
    await expect(top).toContainText(author.person.name);
    await expect(top).toContainText("2 points");
    await expectAccessible(page, "leaderboard 7 days");
  });

  await test.step("the all time tab agrees", async () => {
    await settle(page);
    await page.getByRole("tab", { name: "All time" }).click();
    await expect(page).toHaveURL((url) => url.search.includes("window=all"));
    await expect(page.locator('ol[aria-label="Top members, All time"]')).toContainText("2 points");
  });

  await test.step("removing a like takes the point back", async () => {
    await setLiked(page, firstPost, false);
    await expectPoints(page, slug, author.person.name, "1 point");
  });

  await test.step("turning points off hides the leaderboard", async () => {
    await author.page.goto(`/c/${slug}/manage/settings/points`);
    await settle(author.page);
    const form = author.page.locator("form").filter({ hasText: "Show points and levels" });
    await form.getByRole("switch", { name: "Show points and levels" }).click();
    await form.getByRole("button", { name: "Save points" }).click();
    await expect(author.page.getByText("Settings saved.").first()).toBeVisible();
    await page.goto(`/c/${slug}/members/leaderboard?window=7d`);
    await expect(page.getByText("Leaderboard is turned off for this community")).toBeVisible();
    await page.goto(`/c/${slug}/members`);
    await expect(memberCard(page, author.person.name)).toBeVisible();
    await expect(page.locator('[data-slot="level-badge"]')).toHaveCount(0);
  });
});
