import { expect, type Locator, type Page } from "@playwright/test";

export type Privacy = "public" | "private";

export async function createCommunity(
  page: Page,
  name: string,
  privacy: Privacy = "public",
): Promise<string> {
  await page.goto("/communities/new");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel(privacy === "public" ? "Public" : "Private").check();
  const urlField = page.getByLabel("URL");
  await expect(urlField).not.toHaveValue("");
  const slug = await urlField.inputValue();
  await page.getByRole("button", { name: "Create community" }).click();
  await expect(page).toHaveURL((url) => url.pathname === `/c/${slug}`, { timeout: 30_000 });
  return slug;
}

export async function joinCommunity(page: Page, slug: string): Promise<void> {
  await page.goto(`/c/${slug}`);
  await page.getByRole("button", { name: "Join community" }).first().click();
  await expect(page.getByRole("button", { name: /^Join/ })).toHaveCount(0, { timeout: 30_000 });
}

export function sectionNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Community sections" }).filter({ visible: true });
}

export function sectionLinks(page: Page): Locator {
  return sectionNav(page).first().getByRole("link");
}

function labelPattern(label: string): RegExp {
  const escaped = label
    .split(",")
    .map((part) => part.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^\\s*${escaped.join("\\s*,\\s*")}\\s*$`);
}

export async function expectSections(page: Page, labels: readonly string[]): Promise<void> {
  if (labels.length === 0) {
    await expect(sectionNav(page).getByRole("link")).toHaveCount(0);
    return;
  }
  await expect(sectionLinks(page)).toHaveText(labels.map(labelPattern));
}

export async function expectBottomNavigation(page: Page): Promise<void> {
  const nav = sectionNav(page).first();
  await expect(nav).toBeVisible();
  const viewport = page.viewportSize();
  const box = await nav.boundingBox();
  expect(box, "bottom navigation has a box").not.toBeNull();
  if (box && viewport) {
    expect(box.y + box.height).toBeGreaterThanOrEqual(viewport.height - 2);
  }
  await expect(nav.getByRole("link")).toHaveCount(4);
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, "page scrolls horizontally").toBe(false);
}

export async function requestToJoin(
  page: Page,
  answers: Readonly<Record<string, string>>,
  trigger = "Request to join",
): Promise<void> {
  await page.getByRole("button", { name: trigger }).first().click();
  const dialog = page.getByRole("dialog");
  for (const [label, answer] of Object.entries(answers)) {
    await dialog.getByLabel(label).fill(answer);
  }
  await dialog.getByRole("button", { name: "Send request" }).click();
}
