import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { addDays, createEvent } from "../pages/calendar";
import { createCourse } from "../pages/classroom";
import { createCommunity } from "../pages/community";
import { postMenuAction, posts, settle, writePost } from "../pages/feed";
import { saveAppearance } from "../pages/manage";

type Scheme = "light" | "dark";

interface CardLook {
  readonly radius: string;
  readonly shadow: string;
}

const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;

function readLook(card: Locator): Promise<CardLook> {
  return card.evaluate((element) => {
    const style = getComputedStyle(element);
    return { radius: style.borderTopLeftRadius, shadow: style.boxShadow };
  });
}

async function lookOf(card: Locator): Promise<CardLook> {
  await expect(card).toBeVisible();
  return readLook(card);
}

const expectedLook = {
  soft: { radius: "16px", shadow: expect.not.stringMatching(/^(none)?$/) },
  minimal: { radius: "12px", shadow: "none" },
} as const;

async function expectLook(card: Locator, style: "soft" | "minimal", what: string): Promise<void> {
  await expect(card).toBeVisible();
  await expect.poll(() => readLook(card), { message: `${what} look` }).toEqual(expectedLook[style]);
}

async function expectSurfaces(page: Page, slug: string, style: "soft" | "minimal"): Promise<void> {
  await page.goto(`/c/${slug}`);
  await expectLook(posts(page).first(), style, "feed post");
  await page.goto(`/c/${slug}/classroom`);
  await expectLook(page.locator('[data-slot="course-card"]').first(), style, "course card");
  await page.goto(`/c/${slug}/members`);
  await expectLook(page.locator('[data-slot="member-card"]').first(), style, "member card");
  await page.goto(`/c/${slug}/calendar?view=list`);
  await expectLook(page.locator('article[data-slot="event-card"]').first(), style, "event card");
}

async function capture(page: Page, slug: string, name: string): Promise<void> {
  if (!screenshotDirectory) return;
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.goto(`/c/${slug}`);
  await expect(posts(page).first()).toBeVisible();
  await settle(page);
  await page.screenshot({ path: join(screenshotDirectory, `y2-${name}-desktop.png`) });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/c/${slug}/classroom`);
  await expect(page.locator('[data-slot="course-card"]').first()).toBeVisible();
  await settle(page);
  await page.screenshot({ path: join(screenshotDirectory, `y2-${name}-390.png`) });
  await page.setViewportSize({ width: 1280, height: 900 });
}

function inThreeDays(): string {
  return addDays(new Date().toISOString().slice(0, 10), 3);
}

test("step 17: Soft and Minimal card styles reach every card in a community", async ({ actor }) => {
  test.slow();
  const owner = await actor("Sofia", { desktop: true });
  const page = owner.page;
  const slug = await createCommunity(page, `Cards ${uniqueSuffix()}`, "public");
  const postText = `Soft corners ${uniqueSuffix()}`;

  await test.step("the community has a post, a course, a member, and an event", async () => {
    await writePost(page, slug, postText);
    await createCourse(page, slug, "Card basics");
    await createEvent(page, slug, {
      title: "Card call",
      date: inThreeDays(),
      time: "18:00",
      durationMinutes: 60,
      location: "Online",
    });
  });

  await test.step("Soft gives every card a 16px radius and a shadow in light and dark", async () => {
    await saveAppearance(page, slug, { cardStyle: "Soft" });
    for (const scheme of ["light", "dark"] satisfies Scheme[]) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectSurfaces(page, slug, "soft");
      await capture(page, slug, `soft-${scheme}`);
    }
  });

  await test.step("a dialog opened inside a Soft community gets the Soft radius", async () => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`/c/${slug}`);
    await settle(page);
    await postMenuAction(page, postText, "Delete post");
    const dialog = page.getByRole("dialog");
    expect((await lookOf(dialog)).radius).toBe("16px");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  await test.step("the Soft feed is accessible in light and dark", async () => {
    for (const scheme of ["light", "dark"] satisfies Scheme[]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/c/${slug}`);
      await expect(posts(page).first()).toBeVisible();
      await expectAccessible(page, `Soft feed (${scheme})`);
    }
  });

  await test.step("Minimal keeps a 12px radius and no shadow in light and dark", async () => {
    await saveAppearance(page, slug, { cardStyle: "Minimal" });
    for (const scheme of ["light", "dark"] satisfies Scheme[]) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectSurfaces(page, slug, "minimal");
      await capture(page, slug, `minimal-${scheme}`);
      await page.goto(`/c/${slug}`);
      await expect(posts(page).first()).toBeVisible();
      await expectAccessible(page, `Minimal feed (${scheme})`);
    }
  });

  await test.step("the Appearance preview shows a post card in both modes", async () => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`/c/${slug}/manage/appearance`);
    await settle(page);
    const previews = page
      .getByRole("group", { name: "Preview" })
      .locator('[data-slot="preview-post"]');
    await expect(previews).toHaveCount(2);
    await expectLook(previews.nth(0), "minimal", "light preview");
    await expectLook(previews.nth(1), "minimal", "dark preview");
    await page.getByRole("radio", { name: /^Soft/ }).check();
    await expectLook(previews.nth(0), "soft", "light preview");
    await expectLook(previews.nth(1), "soft", "dark preview");
    const [light, dark] = await Promise.all(
      [0, 1].map((index) => previews.nth(index).evaluate((el) => getComputedStyle(el).boxShadow)),
    );
    expect(light).not.toBe(dark);
    if (screenshotDirectory) {
      await page
        .getByRole("group", { name: "Preview" })
        .screenshot({ path: join(screenshotDirectory, "y2-preview-soft.png") });
    }
  });
});
