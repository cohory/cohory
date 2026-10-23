import { expect, type Page } from "@playwright/test";

import { settle } from "./feed";

export const minimalPdf = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
);

export interface LessonFields {
  readonly title: string;
  readonly videoUrl?: string;
  readonly body?: string;
  readonly pdfName?: string;
  readonly draft?: boolean;
}

export async function createCourse(page: Page, slug: string, title: string): Promise<string> {
  await page.goto(`/c/${slug}/classroom`);
  await settle(page);
  await page
    .getByRole("link", { name: /New course|Create a course/ })
    .first()
    .click();
  await expect(page).toHaveURL((url) => url.pathname.endsWith("/classroom/new"));
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Short description").fill("A two lesson starter course.");
  await page.getByRole("button", { name: "Create course" }).click();
  await expect(page).toHaveURL(
    (url) => /\/classroom\/[^/]+$/.test(url.pathname) && url.search.includes("edit=1"),
    { timeout: 30_000 },
  );
  await expect(page.getByRole("region", { name: "Edit outline" })).toBeVisible();
  return new URL(page.url()).pathname.split("/").pop() ?? "";
}

export async function addLesson(
  page: Page,
  slug: string,
  courseSlug: string,
  moduleTitle: string,
  fields: LessonFields,
): Promise<string> {
  await page.goto(`/c/${slug}/classroom/${courseSlug}?edit=1`);
  await settle(page);
  const outline = page.getByRole("region", { name: "Edit outline" });
  await outline.getByRole("button", { name: `Add lesson to ${moduleTitle}` }).click();
  const titleRow = outline.getByRole("textbox", { name: `New lesson title in ${moduleTitle}` });
  await titleRow.fill(fields.title);
  await titleRow.press("Enter");
  await expect(titleRow).toHaveValue("", { timeout: 30_000 });
  await outline.getByRole("link", { name: fields.title, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit lesson" })).toBeVisible({ timeout: 30_000 });
  await settle(page);
  if (fields.videoUrl) await page.getByLabel("Video link").fill(fields.videoUrl);
  if (fields.body) await page.getByLabel("Lesson content").fill(fields.body);
  if (fields.pdfName) {
    await page.getByLabel("Attachment files").setInputFiles({
      name: fields.pdfName,
      mimeType: "application/pdf",
      buffer: minimalPdf,
    });
    await expect(page.locator("li", { hasText: fields.pdfName }).first()).toBeVisible({
      timeout: 30_000,
    });
  }
  await page
    .getByRole("button", { name: fields.draft ? "Save draft" : "Publish", exact: true })
    .click();
  await expect(page).toHaveURL((url) => !url.search.includes("edit=1"), { timeout: 30_000 });
  await settle(page);
  await expect(page.getByRole("switch", { name: "Publish lesson" })).toHaveAttribute(
    "aria-checked",
    String(!fields.draft),
  );
  return new URL(page.url()).pathname.split("/").pop() ?? "";
}

export async function publishCourse(
  page: Page,
  slug: string,
  courseSlug: string,
  options: { announce?: boolean } = {},
): Promise<void> {
  await page.goto(`/c/${slug}/classroom/${courseSlug}`);
  await settle(page);
  await page.getByRole("button", { name: "Publish course" }).click();
  const dialog = page.getByRole("dialog");
  if (options.announce) {
    await dialog.getByRole("checkbox", { name: "Post an announcement in the feed" }).check();
  }
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("button", { name: "Move to drafts" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("button", { name: "Move to drafts" })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
}

export function playerBar(page: Page) {
  return page.locator('[data-slot="lesson-player-bar"]').filter({ visible: true }).first();
}

export async function markComplete(page: Page): Promise<void> {
  await settle(page);
  const bar = playerBar(page);
  await bar.getByRole("button", { name: "Mark complete", exact: true }).click();
  await expect(bar.getByRole("button", { name: "Completed", exact: true })).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(
      playerBar(page).getByRole("button", { name: "Completed", exact: true }),
    ).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}
