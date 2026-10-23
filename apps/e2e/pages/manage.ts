import { expect, type Locator, type Page } from "@playwright/test";

import { settle } from "./feed";

export interface AppearanceChoice {
  readonly hex?: string | null;
  readonly font?: string;
  readonly cardStyle?: string;
  readonly theme?: string;
}

export interface CommunityTheme {
  readonly theme: string | null;
  readonly cardStyle: string | null;
  readonly accent: string;
  readonly headingFont: string;
  readonly className: string | null;
  readonly style: string | null;
}

export async function saveAppearance(
  page: Page,
  slug: string,
  choice: AppearanceChoice,
): Promise<void> {
  await page.goto(`/c/${slug}/manage/appearance`);
  await settle(page);
  if (choice.hex === null) {
    await page.getByRole("button", { name: "Reset to default" }).click();
  } else if (choice.hex !== undefined) {
    await page.getByLabel("Hex code").fill(choice.hex);
  }
  for (const option of [choice.font, choice.cardStyle, choice.theme]) {
    if (option) await page.getByRole("radio", { name: new RegExp(`^${option}`) }).check();
  }
  await page.getByRole("button", { name: "Save appearance" }).click();
  await expect(page.getByText("Appearance saved.").first()).toBeVisible();
}

export async function themeOf(page: Page): Promise<CommunityTheme> {
  await expect(page.locator("main#content")).toBeVisible();
  return page.evaluate(() => {
    const root = document.querySelector("main#content")?.closest("div.min-h-screen");
    if (!root) throw new Error("community root not found");
    const heading = document.querySelector("main h1, h1");
    return {
      theme: root.getAttribute("data-theme"),
      cardStyle: root.getAttribute("data-card-style"),
      accent: getComputedStyle(root).getPropertyValue("--color-accent").trim(),
      headingFont: heading ? getComputedStyle(heading).fontFamily : "",
      className: root.getAttribute("class"),
      style: root.getAttribute("style"),
    };
  });
}

export async function createInviteLink(
  page: Page,
  slug: string,
  options: { requiresApproval?: boolean } = {},
): Promise<string> {
  await page.goto(`/c/${slug}/manage/people`);
  await settle(page);
  await page.getByRole("button", { name: "Invite people" }).click();
  if (options.requiresApproval) {
    await page.getByLabel("People who use this link need approval").check();
  }
  const before = await page
    .getByLabel("Invite link", { exact: true })
    .evaluateAll((inputs) =>
      inputs.map((input) => (input instanceof HTMLInputElement ? input.value : "")),
    );
  await page.getByRole("button", { name: "Create invite link" }).click();
  await expect(page.getByLabel("Invite link", { exact: true })).toHaveCount(before.length + 1);
  const after = await page
    .getByLabel("Invite link", { exact: true })
    .evaluateAll((inputs) =>
      inputs.map((input) => (input instanceof HTMLInputElement ? input.value : "")),
    );
  const created = after.find((value) => !before.includes(value));
  if (!created) throw new Error("no new invite link appeared");
  return created;
}

export type JoinMode = "Open" | "Approval" | "Invite only";

export async function saveJoinSettings(
  page: Page,
  slug: string,
  options: { mode?: JoinMode; questions?: readonly string[] },
): Promise<void> {
  await page.goto(`/c/${slug}/manage/settings/joining`);
  await settle(page);
  if (options.mode) {
    await page.getByRole("radio", { name: new RegExp(`^${options.mode} `) }).check();
  }
  for (const [index, question] of (options.questions ?? []).entries()) {
    await page.getByRole("button", { name: "Add a question" }).click();
    await page.getByLabel(`Question ${index + 1}`).fill(question);
  }
  await page.getByRole("button", { name: "Save join settings" }).click();
  await expect(page.getByText("Join settings saved.")).toBeVisible();
}

export async function connectStripeAndSavePlan(
  page: Page,
  slug: string,
  { yearly }: { yearly?: string } = {},
): Promise<string> {
  await page
    .context()
    .route(/^https:\/\/(connect|checkout|billing)\.stripe\.test\//, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<title>Stripe</title>" }),
    );
  await page.goto(`/c/${slug}/manage/payments`);
  await settle(page);
  await page.getByRole("button", { name: "Connect your Stripe account" }).click();
  await expect(page).toHaveURL(/^https:\/\/connect\.stripe\.test\/onboard\/acct_/);
  const account = new URL(page.url()).pathname.split("/").pop() ?? "";
  await page.goto(`/c/${slug}/manage/payments?stripe=return`);
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await settle(page);
  await page.getByLabel("Currency").selectOption("usd");
  await page.getByLabel("Monthly price").fill("29");
  if (yearly) {
    await page.getByRole("button", { name: "Add an annual price" }).click();
    await page.getByLabel("Yearly price").fill(yearly);
  }
  await page.getByRole("button", { name: "Put on sale" }).click();
  await expect(page.getByText(/\$29\.00 per month/)).toBeVisible();
  return account;
}

export interface ArchiveDialog {
  readonly dialog: Locator;
  confirm(): Promise<void>;
}

export async function openArchiveDialog(page: Page, slug: string): Promise<ArchiveDialog> {
  await page.goto(`/c/${slug}/manage/settings/danger-zone`);
  await settle(page);
  await page.getByRole("button", { name: "Archive community" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /^Archive / })).toBeVisible();
  return {
    dialog,
    async confirm() {
      await dialog.getByRole("button", { name: "Archive community" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole("button", { name: "Restore community" })).toBeVisible();
    },
  };
}

export async function openRestoreDialog(page: Page, slug: string): Promise<Locator> {
  await page.goto(`/c/${slug}/manage/settings/danger-zone`);
  await settle(page);
  await page.getByRole("button", { name: "Restore community" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /^Restore / })).toBeVisible();
  return dialog;
}

export async function openDisconnectDialog(page: Page, slug: string): Promise<Locator> {
  await page.goto(`/c/${slug}/manage/payments`);
  await settle(page);
  await page.getByRole("button", { name: "Disconnect Stripe" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Disconnect Stripe?" })).toBeVisible();
  return dialog;
}
