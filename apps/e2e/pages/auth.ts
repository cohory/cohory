import { expect, type Page } from "@playwright/test";

import { password, type Person } from "../support/people";

export async function signUpThroughUi(page: Page, who: Person): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(who.name);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/", { timeout: 30_000 });
}

export async function signInThroughUi(page: Page, email: string, secret: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/" || url.pathname.startsWith("/c/"), {
    timeout: 30_000,
  });
}
