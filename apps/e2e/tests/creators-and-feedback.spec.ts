import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { query } from "../support/db";
import { expect, test } from "../support/fixtures";
import { communityEditionUrl } from "../support/stripe";

// Mirrors CREATORS_COMMUNITY_SLUG in scripts/e2e-host.sh and apps/e2e/compose.e2e.yml. The
// Community Edition app on the same database runs without it.
const creatorsSlug = "e2e-creators";
const creatorsName = "E2E Creators";
const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;

test.describe.configure({ mode: "serial" });

async function screenshot(page: Page, name: string): Promise<void> {
  if (!screenshotDirectory) return;
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: join(screenshotDirectory, `${name}.png`) });
}

function footerNav(page: Page) {
  return page.getByRole("navigation", { name: "Legal and support" });
}

test("the footer shows no creators community link until that community exists", async ({
  actor,
}) => {
  const [row] = await query(`select count(*) from communities where slug = '${creatorsSlug}'`);
  test.skip(row?.[0] !== "0", "the creators community already exists in this database");
  const { page } = await actor("Lena", { desktop: true, signedIn: false });
  await page.goto("/terms");
  await expect(footerNav(page).getByRole("link", { name: "Terms" })).toBeVisible();
  await expect(footerNav(page).getByRole("link", { name: creatorsName })).toHaveCount(0);
});

test("the creators community is created by its owner", async ({ actor }) => {
  const [row] = await query(`select count(*) from communities where slug = '${creatorsSlug}'`);
  test.skip(row?.[0] !== "0", "the creators community already exists in this database");
  const { page } = await actor("Riza", { desktop: true });
  await page.goto("/communities/new");
  await page.getByLabel("Name").fill(creatorsName);
  await page.getByLabel("Private").check();
  await page.getByLabel("URL").fill(creatorsSlug);
  await page.getByRole("button", { name: "Create community" }).click();
  await expect(page).toHaveURL((url) => url.pathname === `/c/${creatorsSlug}`, {
    timeout: 30_000,
  });
});

for (const view of ["desktop", "mobile"] as const) {
  test(`a signed out visitor follows the creators link in the footer to its About page (${view})`, async ({
    actor,
  }) => {
    const { page } = await actor("Lena", { [view]: true, signedIn: false });
    await page.goto("/terms");
    const link = footerNav(page).getByRole("link", { name: creatorsName });
    await link.scrollIntoViewIfNeeded();
    await expect(link).toHaveAttribute("href", `/c/${creatorsSlug}`);
    if (screenshotDirectory) {
      mkdirSync(screenshotDirectory, { recursive: true });
      await page
        .locator("footer")
        .last()
        .screenshot({ path: join(screenshotDirectory, `footer-creators-${view}.png`) });
    }
    await link.click();
    await expect(page).toHaveURL((url) => url.pathname === `/c/${creatorsSlug}/about`);
    await expect(page.getByRole("heading", { level: 1, name: creatorsName })).toBeVisible();
  });

  test(`the footer has no creators link where CREATORS_COMMUNITY_SLUG is unset (${view})`, async ({
    actor,
  }) => {
    const { page } = await actor("Lena", { [view]: true, signedIn: false });
    await page.goto(`${communityEditionUrl}/terms`);
    await expect(footerNav(page).getByRole("link", { name: "Terms" })).toBeVisible();
    await expect(footerNav(page).getByRole("link", { name: creatorsName })).toHaveCount(0);
  });

  test(`Send feedback in the account menu opens the contact form about the current page (${view})`, async ({
    actor,
    baseURL,
  }) => {
    const { page } = await actor("Milo", { [view]: true });
    await page.goto("/account");
    await page.getByRole("button", { name: /^Open account menu for / }).click();
    const item = page.getByRole("menu").getByRole("menuitem", { name: "Send feedback" });
    await expect(item).toBeVisible();
    await screenshot(page, `account-menu-feedback-${view}`);
    await item.click();

    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/contact" &&
        url.searchParams.get("topic") === "feedback" &&
        url.searchParams.get("from") === "/account",
    );
    await expect(page.getByLabel("Topic", { exact: true })).toHaveValue("Feedback");
    await expect(page.getByLabel("Page or community link (optional)")).toHaveValue(
      `${baseURL ?? ""}/account`,
    );
    await expect(page.getByLabel("Name", { exact: true })).toHaveAttribute("readonly", "");
  });
}
