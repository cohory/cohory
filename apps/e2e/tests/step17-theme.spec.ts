import type { Page } from "@playwright/test";

import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity } from "../pages/community";
import { saveAppearance } from "../pages/manage";

const darkBackground = "rgb(14, 19, 27)";
const lightBackground = "rgb(248, 250, 252)";

interface PageTheme {
  readonly theme: string | null;
  readonly body: string;
  readonly html: string;
  readonly accent: string;
  readonly darkAccent: string;
  readonly lightAccent: string;
}

async function pageTheme(page: Page): Promise<PageTheme> {
  await expect(page.locator("main").first()).toBeVisible();
  return page.evaluate(() => {
    const root = document.querySelector("[data-community-accent]") ?? document.documentElement;
    const style = getComputedStyle(root);
    return {
      theme: document.documentElement.getAttribute("data-theme"),
      body: getComputedStyle(document.body).backgroundColor,
      html: getComputedStyle(document.documentElement).colorScheme,
      accent: style.getPropertyValue("--color-accent").trim(),
      darkAccent: style.getPropertyValue("--community-dark-color-accent").trim(),
      lightAccent: style.getPropertyValue("--community-light-color-accent").trim(),
    };
  });
}

function watchHydration(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) {
      problems.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    if (/hydrat/i.test(error.message)) problems.push(error.message);
  });
  return problems;
}

test("step 17: System follows the device and Light or Dark wins for the whole page", async ({
  actor,
}) => {
  const owner = await actor("Tomas", { desktop: true });
  const page = owner.page;
  const hydration = watchHydration(page);
  const slug = await createCommunity(page, `Dusk ${uniqueSuffix()}`, "public");
  await saveAppearance(page, slug, { hex: "#0F766E", theme: "System" });

  await test.step("a System community on a dark device renders dark with the dark accent", async () => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/c/${slug}`);
    const theme = await pageTheme(page);
    expect(theme.theme).toBe("dark");
    expect(theme.body).toBe(darkBackground);
    expect(theme.html).toBe("dark");
    expect(theme.darkAccent).not.toBe("");
    expect(theme.accent).toBe(theme.darkAccent);
    await expectAccessible(page, "System community on a dark device");
  });

  await test.step("the page follows the device when its setting changes", async () => {
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(async () => (await pageTheme(page)).body).toBe(lightBackground);
    const theme = await pageTheme(page);
    expect(theme.theme).toBe("light");
    expect(theme.accent).toBe(theme.lightAccent);
  });

  await test.step("a platform page follows the device", async () => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/?home=1");
    expect((await pageTheme(page)).body).toBe(darkBackground);
    await expectAccessible(page, "home on a dark device");
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/?home=1");
    expect((await pageTheme(page)).body).toBe(lightBackground);
  });

  await test.step("a Light community stays light on a dark device", async () => {
    await saveAppearance(page, slug, { theme: "Light" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/c/${slug}`);
    const theme = await pageTheme(page);
    expect(theme.theme).toBe("light");
    expect(theme.body).toBe(lightBackground);
    expect(theme.accent).toBe(theme.lightAccent);
  });

  await test.step("a Dark community is dark on a light device, menus included", async () => {
    await saveAppearance(page, slug, { theme: "Dark" });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`/c/${slug}`);
    const theme = await pageTheme(page);
    expect(theme.theme).toBe("dark");
    expect(theme.body).toBe(darkBackground);
    expect(theme.html).toBe("dark");
    expect(theme.accent).toBe(theme.darkAccent);
    await expectAccessible(page, "Dark community on a light device");

    await page.getByRole("button", { name: /^Open account menu for / }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const menuBackground = await menu.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    expect(menuBackground).not.toBe("rgb(255, 255, 255)");
    await expectAccessible(page, "account menu in a Dark community");

    await menu.getByRole("menuitem", { name: "Account" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/account");
    await expect.poll(async () => (await pageTheme(page)).body).toBe(lightBackground);
  });

  expect(hydration, "hydration errors").toEqual([]);
});
