import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { query, serviceLogs } from "../support/db";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";

// Mirrors CONTACT_EMAIL in scripts/e2e-host.sh and apps/e2e/compose.e2e.yml.
const contactEmail = "contact@e2e.example.test";
const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
const poll = { timeout: 60_000, intervals: [1_000, 2_000] };

interface QueuedContact {
  readonly name: string;
  readonly email: string;
  readonly topic: string;
  readonly link: string | null;
  readonly account: {
    readonly email: string;
    readonly communities: readonly { readonly slug: string }[];
  } | null;
}

async function screenshot(page: Page, name: string): Promise<void> {
  if (!screenshotDirectory) return;
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: join(screenshotDirectory, `${name}.png`), fullPage: true });
}

async function queuedContact(message: string): Promise<QueuedContact> {
  const literal = message.replace(/'/g, "''");
  let found: QueuedContact | undefined;
  await expect
    .poll(async () => {
      const [row] = await query(
        `select data->'data' from pgboss.job where name = 'email.send' and data->>'template' = 'contact-message' and data->>'to' = '${contactEmail}' and data->'data'->>'message' = '${literal}'`,
      );
      found = row?.[0] ? (JSON.parse(row[0]) as QueuedContact) : undefined;
      return found !== undefined;
    }, poll)
    .toBe(true);
  if (!found) throw new Error("no queued contact message");
  return found;
}

async function delivered(topic: string, message: string): Promise<void> {
  const subject = `contact] ${topic}: ${message.slice(0, 60)}"`;
  await expect
    .poll(
      async () =>
        (await serviceLogs("worker"))
          .split("\n")
          .some((line) => line.includes(`to=${contactEmail}`) && line.includes(subject)),
      poll,
    )
    .toBe(true);
}

async function fillAndSend(page: Page, message: string): Promise<void> {
  await page.getByLabel("Message", { exact: true }).fill(message);
  // The form refuses a send within 3 seconds of being shown.
  await page.waitForTimeout(3_500);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Thanks. Your message was sent.")).toBeVisible();
}

for (const view of ["desktop", "mobile"] as const) {
  test(`a signed out visitor writes to the operator from the footer (${view})`, async ({
    actor,
  }) => {
    const { page } = await actor("Lena", { [view]: true, signedIn: false });
    await page.goto("/terms");
    await page
      .getByRole("navigation", { name: "Legal and support" })
      .getByRole("link", { name: "Contact" })
      .click();
    await expect(page).toHaveURL(/\/contact$/);
    await expect(page.getByRole("heading", { level: 1, name: "Contact" })).toBeVisible();

    const message = `Signed out question ${uniqueSuffix()} about moving my group here.`;
    await page.getByLabel("Name", { exact: true }).fill("Lena Visitor");
    await page.getByLabel("Email", { exact: true }).fill(`lena-${uniqueSuffix()}@example.test`);
    await page.getByLabel("Topic", { exact: true }).selectOption("Feedback");
    await screenshot(page, `contact-signed-out-${view}`);
    await fillAndSend(page, message);

    const queued = await queuedContact(message);
    expect(queued).toMatchObject({ name: "Lena Visitor", topic: "Feedback", account: null });
    await delivered("Feedback", message);
  });

  test(`a signed in member sends account details with a prefilled topic and link (${view})`, async ({
    actor,
    baseURL,
  }) => {
    const { page, person } = await actor("Milo", { [view]: true });
    await page.goto("/contact?topic=billing&from=/c/somewhere");

    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(person.name);
    await expect(page.getByLabel("Name", { exact: true })).toHaveAttribute("readonly", "");
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(person.email);
    await expect(page.getByLabel("Topic", { exact: true })).toHaveValue("Billing");
    await expect(page.getByLabel("Page or community link (optional)")).toHaveValue(
      `${baseURL ?? ""}/c/somewhere`,
    );
    await screenshot(page, `contact-signed-in-${view}`);

    const message = `Signed in billing question ${uniqueSuffix()}: was I charged twice?`;
    await fillAndSend(page, message);

    const queued = await queuedContact(message);
    expect(queued).toMatchObject({
      name: person.name,
      email: person.email,
      topic: "Billing",
      link: `${baseURL ?? ""}/c/somewhere`,
      account: { email: person.email, communities: [] },
    });
    await delivered("Billing", message);
  });
}

test("the contact form drops a filled honeypot without sending", async ({ actor }) => {
  const { page } = await actor("Bot", { desktop: true, signedIn: false });
  await page.goto("/contact");
  const message = `Honeypot ${uniqueSuffix()} buy cheap things now please.`;
  await page.getByLabel("Name", { exact: true }).fill("Bot");
  await page.getByLabel("Email", { exact: true }).fill(`bot-${uniqueSuffix()}@example.test`);
  await page.getByLabel("Topic", { exact: true }).selectOption("Other");
  await page.locator('input[name="website"]').fill("https://spam.example.test");
  await fillAndSend(page, message);

  const [row] = await query(
    `select count(*) from pgboss.job where name = 'email.send' and data->'data'->>'message' = '${message}'`,
  );
  expect(row?.[0]).toBe("0");
});
