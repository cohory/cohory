import { expect, type Locator, type Page } from "@playwright/test";

export function memberCard(page: Page, name: string): Locator {
  return page
    .getByRole("list", { name: "Members" })
    .getByRole("listitem")
    .filter({ hasText: name })
    .first();
}

export async function expectPoints(
  page: Page,
  slug: string,
  name: string,
  points: string,
): Promise<void> {
  await expect(async () => {
    await page.goto(`/c/${slug}/members`);
    await expect(memberCard(page, name)).toContainText(points, { timeout: 2_000 });
  }).toPass({ timeout: 45_000, intervals: [1_000, 2_000, 3_000] });
}
