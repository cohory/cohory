import { expect, type Page } from "@playwright/test";

import { settle } from "./feed";

export interface UploadFile {
  readonly name: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
}

export function migrationPath(slug: string): string {
  return `/c/${slug}/manage/migration`;
}

export async function openMigration(page: Page, slug: string): Promise<void> {
  await page.goto(migrationPath(slug));
  await expect(page.getByRole("heading", { name: "Migration", exact: true })).toBeVisible();
  await settle(page);
}

export async function exportArchive(page: Page, slug: string): Promise<Buffer> {
  await openMigration(page, slug);
  await page.getByRole("button", { name: "Start export" }).click();
  const download = page.getByRole("link", { name: "Download latest archive" });
  await expect(download).toBeVisible({ timeout: 120_000 });
  const href = await download.getAttribute("href");
  expect(href, "archive download link").toBeTruthy();
  const response = await page.context().request.get(href ?? "");
  expect(response.status(), "archive download").toBe(200);
  expect(response.headers()["content-type"]).toContain("application/zip");
  return response.body();
}

export async function uploadArchive(page: Page, slug: string, file: UploadFile): Promise<void> {
  await openMigration(page, slug);
  await page.getByLabel("Choose archive (.zip)").setInputFiles(file);
}

export async function confirmArchiveImport(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Import everything" }).click();
  await expect(page.getByText("Import finished")).toBeVisible({ timeout: 120_000 });
}

export async function uploadPlatformFiles(
  page: Page,
  slug: string,
  source: "Skool" | "Circle",
  files: readonly UploadFile[],
): Promise<void> {
  await openMigration(page, slug);
  await page.getByRole("radio", { name: new RegExp(source) }).check();
  await page.getByLabel(`Choose ${source} files`).setInputFiles([...files]);
  await expect(page.getByRole("button", { name: `Import from ${source}` })).toBeVisible({
    timeout: 60_000,
  });
}

export async function confirmPlatformImport(page: Page, source: "Skool" | "Circle"): Promise<void> {
  await page.getByRole("button", { name: `Import from ${source}` }).click();
  await expect(page.getByText("Import finished")).toBeVisible({ timeout: 120_000 });
}
