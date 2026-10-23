import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { password, uniqueSuffix } from "../support/people";
import { createCommunity, expectNoHorizontalScroll } from "../pages/community";
import { settle } from "../pages/feed";

async function expectHeadingOrder(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await settle(page);
  const results = await new AxeBuilder({ page }).withRules(["heading-order"]).analyze();
  expect(
    results.violations.flatMap((violation) => violation.nodes.map((node) => node.html)),
    `heading order on ${path}`,
  ).toEqual([]);
}

test("manage structure: sections on a phone, settings sub sections, privacy confirm, and headings", async ({
  actor,
}) => {
  const owner = await actor("Olga", { mobile: true });
  const name = `Structure ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "private");
  const page = owner.page;

  await test.step("every Manage section is on the first screen of a phone", async () => {
    await page.goto(`/c/${slug}/manage/settings`);
    await settle(page);
    const nav = page.getByRole("navigation", { name: "Manage sections" });
    await expect(nav.getByRole("link")).toHaveText([
      "Overview",
      "Inbox",
      "People",
      "Payments",
      "Appearance",
      "Settings",
      "Migration",
    ]);
    for (const link of await nav.getByRole("link").all()) {
      await expect(link).toBeInViewport();
    }
    await expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expectNoHorizontalScroll(page);
  });

  await test.step("Settings has one form per sub section", async () => {
    const sub = page.getByRole("navigation", { name: "Settings sections" });
    await expect(sub.getByRole("link")).toHaveText([
      "General",
      "Joining",
      "Categories",
      "Points",
      "Agents",
      "Webhooks",
      "Audit log",
      "Danger zone",
    ]);
    await sub.getByRole("link", { name: "Joining" }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/c/${slug}/manage/settings/joining`);
    await expect(page.getByRole("button", { name: "Save join settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete community" })).toHaveCount(0);
    await expectAccessible(page, "manage settings joining on a phone");
  });

  await test.step("points for lessons and events stay off until the owner turns them on", async () => {
    await page.goto(`/c/${slug}/manage/settings/points`);
    await settle(page);
    const lessons = page.getByRole("switch", { name: "Each lesson a member finishes" });
    await expect(lessons).toHaveAttribute("aria-checked", "false");
    await lessons.click();
    await page.getByRole("button", { name: "Save points" }).click();
    await expect(page.getByText("Settings saved.").first()).toBeVisible();
    await page.reload();
    await settle(page);
    await expect(
      page.getByRole("switch", { name: "Each lesson a member finishes" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("switch", { name: "Each event a member attends" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  await test.step("making the community public asks first and says what it does", async () => {
    await page.goto(`/c/${slug}/manage/settings`);
    await settle(page);
    await page.getByRole("radio", { name: /^Public/ }).check();
    await page.getByRole("button", { name: "Save settings" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: `Make ${name} public?` })).toBeVisible();
    await expect(dialog.getByText(/including older ones/)).toBeVisible();
    await expectAccessible(page, "privacy confirm");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await settle(page);
    await expect(page.getByRole("radio", { name: /^Private/ })).toBeChecked();
  });

  await test.step("Manage pages have a clean heading order", async () => {
    for (const path of [
      "",
      "/inbox",
      "/people",
      "/payments",
      "/appearance",
      "/settings",
      "/settings/joining",
      "/settings/categories",
      "/settings/points",
      "/settings/agents",
      "/settings/webhooks",
      "/settings/audit-log",
      "/settings/danger-zone",
      "/migration",
    ]) {
      await expectHeadingOrder(page, `/c/${slug}/manage${path}`);
    }
  });

  await test.step("a signed out owner who opens the requests link signs in and lands on it", async () => {
    await owner.context.clearCookies();
    await page.goto(`/c/${slug}/manage/people?tab=requests`);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/sign-in" &&
        url.searchParams.get("next") === `/c/${slug}/manage/people?tab=requests`,
    );
    await page.getByLabel("Email").fill(owner.person.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === `/c/${slug}/manage/inbox` && url.searchParams.get("tab") === "requests",
      { timeout: 30_000 },
    );
    await expect(page.getByRole("tab", { name: "Requests (0)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, "manage inbox on a phone");
    await page.getByRole("tab", { name: /^Reports/ }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("tab") === "reports");
  });
});
