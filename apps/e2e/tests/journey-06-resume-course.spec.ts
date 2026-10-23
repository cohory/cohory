import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import {
  addLesson,
  createCourse,
  markComplete,
  playerBar,
  publishCourse,
} from "../pages/classroom";
import {
  createCommunity,
  expectBottomNavigation,
  expectNoHorizontalScroll,
  joinCommunity,
  sectionNav,
} from "../pages/community";
import { settle } from "../pages/feed";

test("journey 6: a member resumes a course from the community home", async ({
  actor,
  isMobile,
}) => {
  const owner = await actor("Olga", { desktop: true });
  const slug = await createCommunity(owner.page, `Learning ${uniqueSuffix()}`, "public");
  const courseSlug = await createCourse(owner.page, slug, "Intro to cohory");
  const firstLesson = await addLesson(owner.page, slug, courseSlug, "Module 1", {
    title: "Watch the intro",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  });
  const secondLesson = await addLesson(owner.page, slug, courseSlug, "Module 1", {
    title: "Reading the docs",
    body: "## Read this\n\nThe second lesson.",
  });
  await publishCourse(owner.page, slug, courseSlug);

  const member = await actor("Bea");
  const { page } = member;
  await joinCommunity(page, slug);

  await test.step("Classroom shows the course as not started", async () => {
    await page.goto(`/c/${slug}/classroom`);
    const card = page.locator('[data-slot="course-card"]', { hasText: "Intro to cohory" });
    await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    await expect(card).toContainText("Not started");
    await expect(card).not.toContainText("Draft");
    await expectAccessible(page, "classroom (member)");
  });

  await test.step("Start opens the first lesson", async () => {
    await page
      .locator('[data-slot="course-card"] a', { hasText: "Intro to cohory" })
      .first()
      .click();
    await expect(page).toHaveURL((url) => url.pathname.endsWith(`/classroom/${courseSlug}`));
    await expectAccessible(page, "course detail (member)");
    await settle(page);
    await page.getByRole("link", { name: "Start" }).click();
    await expect(page).toHaveURL((url) => url.pathname.endsWith(`/${firstLesson}`));
    await expect(page.locator('[data-slot="lesson-video-placeholder"]')).toContainText("YouTube");
    await expectAccessible(page, "lesson player (member)");
  });

  if (isMobile) {
    await test.step("on a phone the lesson list sits behind a toggle", async () => {
      await expect(page.locator('[data-slot="lesson-player-sidebar"]')).toBeHidden();
      await expectBottomNavigation(page);
      await expectNoHorizontalScroll(page);
      await page.getByRole("button", { name: "Show lessons" }).click();
      await expect(page.locator('[data-slot="lesson-player-sidebar"]')).toBeVisible();
      await expectAccessible(page, "lesson list open (phone)");
      await page.getByRole("button", { name: "Hide lessons" }).click();
      await expect(page.locator('[data-slot="lesson-player-sidebar"]')).toHaveCount(0);
    });

    await test.step("on a short phone screen the lesson bar sits above the tab bar", async () => {
      const viewport = page.viewportSize();
      await page.setViewportSize({ width: 390, height: 520 });
      await page.evaluate(() => window.scrollTo(0, 0));
      const bar = await playerBar(page).boundingBox();
      const tabs = await sectionNav(page).first().boundingBox();
      expect(bar, "lesson bar has a box").not.toBeNull();
      expect(tabs, "tab bar has a box").not.toBeNull();
      if (bar && tabs) {
        expect(bar.y + bar.height).toBeLessThanOrEqual(tabs.y + 2);
        expect(bar.y + bar.height).toBeGreaterThan(tabs.y - 40);
      }
      if (viewport) await page.setViewportSize(viewport);
    });
  }

  await test.step("completing the first lesson puts the course at half", async () => {
    await markComplete(page);
    await page.goto(`/c/${slug}/classroom/${courseSlug}`);
    await expect(page.getByRole("progressbar").first()).toHaveAttribute("aria-valuenow", "50");
  });

  await test.step("the community home offers Continue learning at the next lesson", async () => {
    await page.goto(`/c/${slug}`);
    const card = page.locator('[data-slot="continue-learning-card"]:visible');
    await expect(card).toContainText("Reading the docs");
    await expect(card).toContainText("50%");
    await expectAccessible(page, "community home with continue learning");
    await settle(page);
    await card.getByRole("link", { name: /^Continue / }).click();
    await expect(page).toHaveURL((url) => url.pathname.endsWith(`/${secondLesson}`));
  });

  await test.step("finishing the course removes the card", async () => {
    await markComplete(page);
    await page.goto(`/c/${slug}`);
    await expect(page.locator('[data-slot="continue-learning-card"]')).toHaveCount(0);
    await page.goto(`/c/${slug}/classroom/${courseSlug}`);
    await expect(page.getByRole("progressbar").first()).toHaveAttribute("aria-valuenow", "100");
  });
});
