import { expectAccessible } from "../support/axe";
import { enqueueJob, query } from "../support/db";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, expectNoHorizontalScroll } from "../pages/community";
import { posts, settle } from "../pages/feed";

test("step 13 scheduled posts: a post scheduled for later publishes once when its time comes", async ({
  actor,
}) => {
  const owner = await actor("Sofia", { desktop: true });
  const slug = await createCommunity(owner.page, `Later ${uniqueSuffix()}`, "public");
  const text = `Weekly digest ${uniqueSuffix()}`;
  const page = owner.page;
  const day = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  await test.step("the owner schedules a post from the composer", async () => {
    await page.goto(`/c/${slug}`);
    await page.getByRole("button", { name: "Write something" }).click();
    const composer = page.getByRole("group", { name: "New post" });
    await composer.getByRole("textbox", { name: "Write something" }).fill(text);
    await composer.getByRole("button", { name: "Schedule for later" }).click();
    await composer.getByLabel("Publish on").fill(`${day}T09:00`);
    await composer.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(page.getByRole("link", { name: "1 scheduled post" })).toBeVisible();
    await expect(posts(page).filter({ hasText: text })).toHaveCount(0);
  });

  await test.step("the scheduled page lists it and passes axe on desktop and phone", async () => {
    await page.getByRole("link", { name: "1 scheduled post" }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${slug}/posts/scheduled`));
    await settle(page);
    const list = page.getByRole("list", { name: "Scheduled posts" });
    await expect(list.getByText(text)).toBeVisible();
    await expect(list.locator("time")).toHaveText(/ at 09:00 \(Europe\/Berlin\)$/);
    await expectAccessible(page, "scheduled posts");
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, "scheduled posts on a phone");
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await test.step("when the time comes the job publishes it exactly once", async () => {
    await query(
      `update posts set scheduled_at = now() - interval '1 minute' where body_text = '${text}' and scheduled_at is not null`,
    );
    await enqueueJob("posts.publish-scheduled");
    await enqueueJob("posts.publish-scheduled");
    await page.goto(`/c/${slug}`);
    await expect(posts(page).filter({ hasText: text })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /scheduled post/ })).toHaveCount(0);
    const rows = await query(
      `select count(*) from posts p join communities c on c.id = p.community_id where c.slug = '${slug}' and p.body_text = '${text}'`,
    );
    expect(rows[0]?.[0]).toBe("1");
  });
});
