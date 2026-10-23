import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, expectNoHorizontalScroll, joinCommunity } from "../pages/community";
import { bell, expectUnread, likeButton, posts, setLiked, writePost } from "../pages/feed";

test("journey 5: members post, comment, react, and get notified", async ({ actor, isMobile }) => {
  const author = await actor("Ada", { desktop: true });
  const member = await actor("Bea");
  const slug = await createCommunity(author.page, `Feed ${uniqueSuffix()}`, "public");
  await joinCommunity(member.page, slug);
  const comment = `Thanks for sharing ${uniqueSuffix()}`;
  const reply = `Glad it helps ${uniqueSuffix()}`;

  const postPath =
    await test.step("the author posts bold text, a video link, and an image", async () => {
      const path = await writePost(
        author.page,
        slug,
        "Hello **bold** world https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        { image: true },
      );
      const article = posts(author.page).first();
      await expect(article.locator("strong", { hasText: "bold" })).toBeVisible();
      await expect(article.getByRole("button", { name: "Load YouTube video" })).toHaveCount(1);
      const image = article.locator("img[src*='/api/uploads/']").first();
      await expect(image).toHaveJSProperty("complete", true);
      expect(
        await image.evaluate((element: HTMLImageElement) => element.naturalWidth),
      ).toBeGreaterThan(0);
      await article.getByRole("button", { name: "Post options" }).click();
      await expect(author.page.getByRole("menuitem").first()).toBeVisible();
      await author.page.keyboard.press("Escape");
      await expect(author.page.getByRole("menu")).toHaveCount(0);
      await expectAccessible(author.page, "feed (author)");
      return path;
    });

  await test.step("the member sees the post in the feed", async () => {
    await member.page.goto(`/c/${slug}`);
    await expect(posts(member.page).first()).toContainText("bold");
    if (isMobile) {
      const composer = member.page
        .locator('[data-slot="post-composer"]')
        .filter({ visible: true })
        .first();
      const box = await composer.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(340);
      await expectNoHorizontalScroll(member.page);
    }
    await expectAccessible(member.page, "feed (member)");
  });

  await test.step("the member comments and likes", async () => {
    const { page } = member;
    await page.goto(postPath);
    await page.getByRole("textbox", { name: "Write a comment" }).fill(comment);
    await page
      .locator('[data-slot="comment-composer"]')
      .getByRole("button", { name: "Post", exact: true })
      .click();
    await expect(
      page
        .getByRole("article", { name: `Comment by ${member.person.name}` })
        .filter({ hasText: comment }),
    ).toBeVisible();
    await setLiked(page, postPath, true);
    await expect(likeButton(page)).toHaveAttribute("aria-label", "Like, 1 like");
    await expectAccessible(page, "post detail (member)");
  });

  await test.step("the owner's bell shows the join, the like, and the comment, and opens the post", async () => {
    const { page } = author;
    await expectUnread(page, `/c/${slug}`, 3);
    await bell(page).click();
    await expect(page.getByText(/joined the community/).first()).toBeVisible();
    await expect(page.getByText(/liked your post/).first()).toBeVisible();
    await expect(page.getByText(comment).first()).toBeVisible();
    const item = page.getByText(/commented on your post/).first();
    await expect(item).toBeVisible();
    await expectAccessible(page, "notifications open");
    await item.click();
    await expect(page).toHaveURL((url) => url.pathname === postPath);
  });

  await test.step("the author replies to the comment", async () => {
    const { page } = author;
    await page.goto(postPath);
    const thread = page.getByRole("article", { name: `Comment by ${member.person.name}` }).first();
    await thread.getByRole("button", { name: "Reply" }).click();
    const box = page.getByRole("textbox", { name: `Reply to ${member.person.name}` });
    await box.fill(reply);
    await page
      .locator('[data-slot="comment-composer"]')
      .filter({ has: box })
      .getByRole("button", { name: "Post", exact: true })
      .click();
    await expect(
      page
        .getByRole("article", { name: `Comment by ${author.person.name}` })
        .filter({ hasText: reply }),
    ).toBeVisible();
    await expectAccessible(page, "post detail with reply");
  });

  await test.step("the member's bell shows the reply", async () => {
    await expectUnread(member.page, `/c/${slug}`, 1);
    await bell(member.page).click();
    await expect(member.page.getByText(/replied/).first()).toBeVisible();
  });
});
