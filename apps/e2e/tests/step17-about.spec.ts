import type { Locator, Page } from "@playwright/test";

import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, expectNoHorizontalScroll, joinCommunity } from "../pages/community";
import { settle } from "../pages/feed";
import { connectStripeAndSavePlan, saveJoinSettings } from "../pages/manage";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function galleryRows(page: Page) {
  return page.locator('ol[aria-label="Gallery items"] > li');
}

async function uploadImage(page: Page, name: string, expected: number): Promise<void> {
  await page
    .locator('input[aria-label="Gallery image"]')
    .setInputFiles({ name, mimeType: "image/png", buffer: png });
  await expect(galleryRows(page)).toHaveCount(expected, { timeout: 30_000 });
}

test("about page: gallery, detailed description, and the way members reach it", async ({
  actor,
}) => {
  const owner = await actor("Orla", { desktop: true });
  const name = `Studio ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "public");
  const page = owner.page;

  await test.step("the owner adds two images and a video link", async () => {
    await page.goto(`/c/${slug}/manage/appearance`);
    await expect(page.getByRole("heading", { name: "About page" })).toBeVisible();
    await uploadImage(page, "studio.png", 1);
    await uploadImage(page, "desk.png", 2);
    await page.getByLabel("Video link").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await page.getByRole("button", { name: "Add video" }).click();
    await expect(galleryRows(page)).toHaveCount(3);
    await expect(galleryRows(page).nth(2)).toContainText("YouTube video 3");
    await page.getByLabel("Alt text for Image 1").fill("The studio at night");
    await page.getByLabel("Alt text for Image 1").blur();
    await expect(page.getByRole("status").filter({ hasText: "Alt text saved." })).toBeAttached();
  });

  await test.step("a link from another host is refused", async () => {
    await page.getByLabel("Video link").fill("https://evil.example/watch?v=dQw4w9WgXcQ");
    await page.getByRole("button", { name: "Add video" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Paste a YouTube, Vimeo, or Loom video link." }),
    ).toBeVisible();
    await expect(galleryRows(page)).toHaveCount(3);
  });

  await test.step("the add bar keeps the upload button, link field, and counter aligned", async () => {
    const upload = await page.getByRole("button", { name: "Upload image" }).boundingBox();
    const field = await page.getByLabel("Video link").boundingBox();
    const add = await page.getByRole("button", { name: "Add video" }).boundingBox();
    expect(Math.abs((upload?.y ?? 0) - (field?.y ?? 1))).toBeLessThanOrEqual(1);
    expect(Math.abs((field?.y ?? 0) - (add?.y ?? 1))).toBeLessThanOrEqual(1);
    expect(Math.abs((field?.x ?? 0) + (field?.width ?? 0) - (add?.x ?? 0))).toBeLessThanOrEqual(2);
    await expect(page.getByText(/^3 of 10/)).toBeVisible();
    await expect(galleryRows(page).nth(2).locator("img")).toHaveAttribute(
      "src",
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
  });

  await test.step("the owner moves the video up with the keyboard and makes it the hero", async () => {
    await page.getByRole("button", { name: "Actions for YouTube video 3" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Move up" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(galleryRows(page).nth(1)).toContainText("YouTube video 2");
    await expect(page.getByRole("button", { name: "Actions for YouTube video 2" })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Make hero" }).click();
    await expect(galleryRows(page).nth(0)).toContainText("YouTube video 1");
    await expect(galleryRows(page).nth(0).getByText("Hero", { exact: true })).toBeVisible();
    await expect(page.getByText("Hero", { exact: true })).toHaveCount(1);
  });

  await test.step("the owner writes the About page text and saves it once", async () => {
    await page.getByRole("textbox", { name: "Short description" }).fill("Critiques for makers.");
    await page.getByRole("button", { name: "Add a line" }).click();
    await page.getByRole("textbox", { name: "Line 1" }).fill("Weekly critiques");
    await page.getByRole("button", { name: "Add a line" }).click();
    await page.getByRole("textbox", { name: "Line 2" }).fill("Open desk hours");
    await page
      .getByRole("textbox", { name: "Detailed description" })
      .fill(
        "Welcome to the **studio**.\n## How it works\n- Bring your sketchbook\n- Share one piece a week",
      );
    await page.getByRole("textbox", { name: "Credential" }).fill("Illustrator for 12 years");
    await page
      .getByRole("textbox", { name: "Bio" })
      .fill("I run the studio and review every piece.");
    await page.getByRole("button", { name: "How do I cancel?" }).click();
    await page.getByRole("textbox", { name: "Answer 1" }).fill("From your account, any time.");
    await page.getByRole("button", { name: "Save About page" }).click();
    await expect(page.getByText("About page saved.")).toBeVisible();
    await expectAccessible(page, "manage appearance with gallery");
  });

  await test.step("the gallery manager fits a 390 wide screen", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(galleryRows(page)).toHaveCount(3);
    await expectNoHorizontalScroll(page);
    for (const row of await galleryRows(page).all()) {
      const box = await row.boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    }
    await expectAccessible(page, "manage appearance with gallery (390)");
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await test.step("a visitor sees the About page with the gallery and description", async () => {
    const visitor = await actor("Vera", { desktop: true, signedIn: false });
    await visitor.page.goto(`/c/${slug}/about`);
    await expect(visitor.page.getByRole("heading", { level: 1, name })).toBeVisible();
    const gallery = visitor.page.getByRole("region", { name: "Gallery" });
    await expect(gallery.getByRole("button", { name: /^Play YouTube video/ })).toBeVisible();
    await expect(gallery.locator("iframe")).toHaveCount(0);
    const thumbnails = gallery.getByRole("list", { name: "Gallery items" }).getByRole("button");
    await expect(thumbnails).toHaveCount(3);
    await thumbnails.nth(1).click();
    await expect(thumbnails.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(gallery.locator("img[alt='The studio at night']")).toBeVisible();
    await expect(gallery.locator("iframe")).toHaveCount(0);
    await gallery.getByRole("button", { name: "Next item" }).click();
    await expect(gallery.getByText("3 / 3")).toBeVisible();
    await thumbnails.nth(2).press("Home");
    await expect(thumbnails.nth(0)).toBeFocused();
    await expect(thumbnails.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(gallery.locator("iframe")).toHaveCount(0);
    await gallery.getByRole("button", { name: /^Play YouTube video/ }).click();
    await expect(gallery.locator("iframe")).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1",
    );
    await expect(visitor.page).toHaveTitle(new RegExp(`^About ${name} · `));
    await expect(visitor.page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "Critiques for makers.",
    );
    const offer = visitor.page.getByRole("region", { name: "What you get" });
    await expect(offer.getByRole("listitem")).toHaveText(["Weekly critiques", "Open desk hours"]);
    await expect(
      visitor.page.getByRole("listitem").filter({ hasText: "Share one piece a week" }),
    ).toBeVisible();
    await expect(
      visitor.page.getByRole("heading", { level: 3, name: "How it works" }),
    ).toBeVisible();
    await expect(
      visitor.page
        .getByRole("region", { name: "About the host" })
        .getByText("Illustrator for 12 years"),
    ).toBeVisible();
    await visitor.page.getByRole("link", { name: /^By / }).click();
    await expect(visitor.page).toHaveURL(/#host$/);
    const faq = visitor.page.getByRole("region", { name: "Questions" });
    await expect(faq.getByText("From your account, any time.")).toBeHidden();
    await faq.getByText("How do I cancel?").click();
    await expect(faq.getByText("From your account, any time.")).toBeVisible();
    await expect(visitor.page.getByText("Admins")).toHaveCount(0);
    await expect(
      visitor.page.locator("#join").getByRole("button", { name: "Join community" }),
    ).toBeVisible();
    const card = visitor.page.getByRole("complementary", { name: `Join ${name}` });
    await expect(card.getByRole("button", { name: "Join community" })).toBeVisible();
    const closing = visitor.page.getByRole("region", { name: `Join ${name}` });
    await expect(closing.getByRole("button", { name: "Join community" })).toBeVisible();
    await expect(visitor.page.locator('[data-slot="sticky-join"]')).toBeHidden();
    await expectAccessible(visitor.page, "about page (visitor)");

    const response = await visitor.context.request.get(`/api/v1/communities/${slug}`);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { gallery: { kind: string }[] };
    expect(body.gallery.map((item) => item.kind)).toEqual(["video_embed", "image", "image"]);
  });

  await test.step("a visitor who prefers reduced motion also gets click to play", async () => {
    const calm = await actor("Cara", { desktop: true, signedIn: false, reducedMotion: "reduce" });
    await calm.page.goto(`/c/${slug}/about`);
    const gallery = calm.page.getByRole("region", { name: "Gallery" });
    const thumbnails = gallery.getByRole("list", { name: "Gallery items" }).getByRole("button");
    await thumbnails.nth(1).click();
    await expect(thumbnails.nth(1)).toHaveAttribute("aria-pressed", "true");
    await thumbnails.nth(0).click();
    await expect(thumbnails.nth(0)).toHaveAttribute("aria-pressed", "true");
    const play = gallery.getByRole("button", { name: /^Play YouTube video/ });
    await expect(play).toBeVisible();
    await expect(gallery.locator("iframe")).toHaveCount(0);
    await play.click();
    await expect(gallery.locator("iframe")).toHaveAttribute("src", /autoplay=1&playsinline=1$/);
  });

  await test.step("the About page works at 390 pixels with the join button in reach", async () => {
    const mobile = await actor("Milo", { mobile: true, signedIn: false });
    await mobile.page.goto(`/c/${slug}/about`);
    const join = mobile.page.locator("#join").getByRole("button", { name: "Join community" });
    await expect(join).toBeInViewport();
    const bar = mobile.page.locator('[data-slot="sticky-join"]');
    await expect(bar).toBeHidden();
    await expect(mobile.page.getByRole("region", { name: "Gallery" })).toBeVisible();
    await expectNoHorizontalScroll(mobile.page);
    await expectAccessible(mobile.page, "about page (390)");
    await mobile.page.setViewportSize({ width: 390, height: 600 });
    await mobile.page
      .getByRole("region", { name: "What you get" })
      .evaluate((element) => element.scrollIntoView({ block: "start" }));
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("button", { name: "Join community" })).toBeInViewport();
    const tabs = mobile.page.getByRole("navigation", { name: "Community sections" }).last();
    const barBox = await bar.boundingBox();
    const tabsBox = await tabs.boundingBox();
    expect((barBox?.y ?? 0) + (barBox?.height ?? 0)).toBeLessThanOrEqual((tabsBox?.y ?? 0) + 1);
    await expectAccessible(mobile.page, "about page with the join bar (390)");
    await mobile.page.getByRole("region", { name: `Join ${name}` }).scrollIntoViewIfNeeded();
    await expect(bar).toBeHidden();
  });

  await test.step("a member keeps four tabs and can still open About directly", async () => {
    const member = await actor("Mara", { desktop: true });
    await joinCommunity(member.page, slug);
    await member.page.goto(`/c/${slug}`);
    await expect(member.page.getByRole("region", { name: "Gallery" })).toHaveCount(0);
    await expect(
      member.page.getByRole("navigation", { name: "Community sections" }).first(),
    ).toBeVisible();
    await expect(member.page.locator(`a[href="/c/${slug}/about"]`)).toHaveCount(0);
    await expect(
      member.page.getByRole("banner").getByRole("link", { name, exact: true }).first(),
    ).toHaveAttribute("href", `/c/${slug}`);
    await member.page.goto(`/c/${slug}/about`);
    await expect(member.page.getByRole("region", { name: "Gallery" })).toBeVisible();
    await expect(member.page.getByRole("heading", { name: `About ${name}` })).toHaveCount(0);
    await expect(member.page.getByRole("button", { name: "Join community" })).toHaveCount(0);
    await expectAccessible(member.page, "about page (member)");
    await member.page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(member.page);
    await expectAccessible(member.page, "about page (member, 390)");
  });
});

test("about page: every join control of an invite only paid community says invite only", async ({
  actor,
}) => {
  const owner = await actor("Odin", { desktop: true });
  const slug = await createCommunity(owner.page, `Atelier ${uniqueSuffix()}`, "public");
  await connectStripeAndSavePlan(owner.page, slug);

  const visitor = await actor("Vida", { mobile: true });
  await visitor.page.goto(`/c/${slug}/about`);
  await settle(visitor.page);
  await expect(
    visitor.page.getByRole("button", { name: "Join for $29.00/month" }).first(),
  ).toBeVisible();

  await saveJoinSettings(owner.page, slug, { mode: "Invite only" });
  await visitor.page.reload();
  await settle(visitor.page);
  await expect(visitor.page.getByRole("link", { name: /Join for/ })).toHaveCount(0);
  await expect(visitor.page.getByRole("button", { name: /Join for/ })).toHaveCount(0);
  await expect(visitor.page.getByText("Invite only", { exact: true }).first()).toBeVisible();
  await expectAccessible(visitor.page, "about page (invite only, paid)");
});

const phones = [
  { width: 390, height: 844 },
  { width: 360, height: 740 },
] as const;

async function showStickyBar(page: Page): Promise<Locator> {
  await page.evaluate(() => {
    const hero = document.getElementById("join");
    window.scrollTo(0, (hero?.getBoundingClientRect().bottom ?? 0) + window.scrollY + 120);
  });
  const bar = page.locator('[data-slot="sticky-join"]');
  await expect(bar).toBeVisible();
  return bar;
}

async function expectInside(locator: Locator, width: number, height: number): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, "has a box").not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 0.5);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height + 0.5);
}

async function expectStickyBarFits(page: Page, width: number, height: number): Promise<void> {
  const bar = await showStickyBar(page);
  await expectInside(bar, width, height);
  const tabs = page.getByRole("navigation", { name: "Community sections" }).last();
  const barBox = await bar.boundingBox();
  const tabsBox = await tabs.boundingBox();
  expect((barBox?.y ?? 0) + (barBox?.height ?? 0)).toBeLessThanOrEqual((tabsBox?.y ?? 0) + 1);
  await expect(bar.getByRole("button", { name: "Join for $29.00/month" })).toBeVisible();
  for (const control of await bar.getByRole("button").all()) {
    await expectInside(control, width, height);
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  const price = bar.locator("p").filter({ hasText: "$29.00/month" });
  await expect(price).toHaveText("$29.00/month · Cancel anytime");
  expect(
    await price.evaluate((line) => line.scrollWidth <= line.clientWidth && line.clientHeight <= 24),
    "the price stays on one uncut line",
  ).toBe(true);
  await expectNoHorizontalScroll(page);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(bar).toBeHidden();
  const footer = page.locator("footer").last();
  await expect(footer).toBeInViewport({ ratio: 1 });
  const last = await footer.boundingBox();
  const tabsAtEnd = await tabs.boundingBox();
  expect((last?.y ?? 0) + (last?.height ?? 0)).toBeLessThanOrEqual((tabsAtEnd?.y ?? 0) + 1);
}

test("about page: the sticky price bar of a paid community fits a phone", async ({ actor }) => {
  const owner = await actor("Pia", { desktop: true });
  const name = `Watercolour Sketching Club for Beginners ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "public");
  await connectStripeAndSavePlan(owner.page, slug, { yearly: "290" });
  await owner.page.goto(`/c/${slug}/manage/appearance`);
  await owner.page
    .getByRole("textbox", { name: "Detailed description" })
    .fill(Array.from({ length: 30 }, (_, week) => `Week ${week + 1} brings a study.`).join("\n\n"));
  await owner.page.getByRole("button", { name: "Save About page" }).click();
  await expect(owner.page.getByText("About page saved.")).toBeVisible();

  const guest = await actor("Gus", { mobile: true, signedIn: false });
  const visitor = await actor("Vic", { mobile: true });
  for (const { page } of [guest, visitor]) {
    for (const { width, height } of phones) {
      await page.setViewportSize({ width, height });
      await page.goto(`/c/${slug}/about`);
      await settle(page);
      await expectStickyBarFits(page, width, height);
    }
  }
});
