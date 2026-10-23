import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

import type { Locator, Page } from "@playwright/test";

import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, joinCommunity } from "../pages/community";

const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
const coverRatio = 4;

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function gradientPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      rows.set([40 + (x * 160) / width, 90 + (y * 120) / height, 170], row + 1 + x * 3);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const cover = gradientPng(1600, 400);

async function uploadCover(page: Page, slug: string): Promise<void> {
  await page.goto(`/c/${slug}/manage/appearance`);
  await page
    .getByLabel("Cover image", { exact: true })
    .setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: cover });
  await expect(
    page.locator('[data-slot="branding-preview"] img[src*="/branding/cover"]'),
  ).toBeVisible({
    timeout: 30_000,
  });
}

async function expectCoverRatio(image: Locator, expected = coverRatio): Promise<void> {
  await expect(image).toBeVisible();
  const box = await image.boundingBox();
  expect(box).not.toBeNull();
  const ratio = (box?.width ?? 0) / (box?.height ?? 1);
  expect(Math.abs(ratio - expected)).toBeLessThanOrEqual(0.05);
}

async function screenshot(page: Page, name: string): Promise<void> {
  if (!screenshotDirectory) return;
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: join(screenshotDirectory, `z2-${name}.png`) });
}

test("step 18: the cover shows only on About at 4:1 and gallery videos never autoplay", async ({
  actor,
}) => {
  test.slow();
  const owner = await actor("Cora", { desktop: true });
  const name = `Print shop ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "public");

  await test.step("the owner uploads a cover and adds a gallery video", async () => {
    await uploadCover(owner.page, slug);
    await expect(
      owner.page.getByText("Use 1600 × 400 or larger, up to 5 MB.", { exact: false }),
    ).toBeVisible();
    await expectCoverRatio(owner.page.locator('[data-slot="branding-preview"]').nth(1));
    await owner.page.getByLabel("Video link").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await owner.page.getByRole("button", { name: "Add video" }).click();
    await expect(owner.page.locator('ol[aria-label="Gallery items"] > li')).toHaveCount(1);
  });

  await test.step("a visitor sees the cover at 4:1 and the hero video waits for a click", async () => {
    const visitor = await actor("Viv", { desktop: true, signedIn: false });
    const page = visitor.page;
    await page.goto(`/c/${slug}/about`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expectCoverRatio(page.locator('[data-slot="community-cover"]'));
    const gallery = page.getByRole("region", { name: "Gallery" });
    const play = gallery.getByRole("button", { name: /^Play YouTube video/ });
    await expect(play).toBeVisible();
    await expect(gallery.locator("iframe")).toHaveCount(0);
    await expectAccessible(page, "about page with cover");
    await screenshot(page, "about-1280");
    await play.click();
    await expect(gallery.locator("iframe")).toHaveAttribute("src", /autoplay=1&playsinline=1$/);
    await expect(gallery.locator("iframe")).not.toHaveAttribute("src", /mute=1/);
  });

  await test.step("the cover is taller, 3:1, on a 390 wide screen", async () => {
    const mobile = await actor("Moe", { mobile: true, signedIn: false });
    await mobile.page.goto(`/c/${slug}/about`);
    await expectCoverRatio(mobile.page.locator('[data-slot="community-cover"]'), 3);
    await expect(
      mobile.page.getByRole("region", { name: "Gallery" }).locator("iframe"),
    ).toHaveCount(0);
    await expectAccessible(mobile.page, "about page with cover (390)");
    await screenshot(mobile.page, "about-390");
  });

  await test.step("link previews of a public community use the cover", async () => {
    const visitor = await actor("Lia", { desktop: true, signedIn: false });
    await visitor.page.goto(`/c/${slug}/about`);
    const ogImage = visitor.page.locator('meta[property="og:image"]');
    await expect(ogImage).toHaveCount(1);
    expect(await ogImage.getAttribute("content")).toMatch(/^https?:\/\/[^/]+\/.*\/branding\/cover/);
    await expect(visitor.page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );
    await expect(visitor.page.locator('meta[name="twitter:image"]')).toHaveAttribute(
      "content",
      /\/branding\/cover/,
    );
  });

  await test.step("members see no cover on the feed, and Your communities cards use 4:1", async () => {
    const member = await actor("Mika", { desktop: true });
    await joinCommunity(member.page, slug);
    await member.page.goto(`/c/${slug}`);
    await expect(member.page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(member.page.locator('[data-slot="community-cover"]')).toHaveCount(0);
    await expect(member.page.locator('img[src*="/branding/cover"]')).toHaveCount(0);
    await screenshot(member.page, "member-feed-1280");

    await member.page.goto("/?home=1");
    const card = member.page.locator(`[data-slot="my-community-card"][href="/c/${slug}"]`);
    await expectCoverRatio(card.locator('img[src*="/branding/cover"]'));
  });

  await test.step("a private community never puts its cover in link previews", async () => {
    const privateSlug = await createCommunity(owner.page, `Back room ${uniqueSuffix()}`, "private");
    await uploadCover(owner.page, privateSlug);
    await owner.page.goto(`/c/${privateSlug}`);
    await expect(owner.page.locator('meta[property="og:image"]')).toHaveCount(0);
    await expect(owner.page.locator('meta[name="twitter:image"]')).toHaveCount(0);

    const visitor = await actor("Pia", { desktop: true, signedIn: false });
    await visitor.page.goto(`/c/${privateSlug}/about`);
    await expect(visitor.page.locator('[data-slot="community-cover"]')).toBeVisible();
    await expect(visitor.page.locator('meta[property="og:image"]')).toHaveCount(0);
    await expect(visitor.page.locator('meta[name="twitter:image"]')).toHaveCount(0);
  });
});
