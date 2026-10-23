import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expectAccessible } from "../support/axe";
import { query, userIdOf } from "../support/db";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, expectNoHorizontalScroll } from "../pages/community";
import { writePost } from "../pages/feed";
import { openArchiveDialog } from "../pages/manage";

// Mirrors CONTACT_EMAIL in scripts/e2e-host.sh and apps/e2e/compose.e2e.yml.
const contactEmail = "contact@e2e.example.test";
const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
const poll = { timeout: 60_000, intervals: [1_000, 2_000] };
const question = "How easy was it to publish your first post?";

interface QueuedFeedback {
  readonly kind: string;
  readonly topic: string;
  readonly score: number | null;
  readonly reason: string | null;
  readonly comment: string | null;
  readonly userId: string;
  readonly communitySlug: string | null;
}

async function screenshot(page: Page, name: string): Promise<void> {
  if (!screenshotDirectory) return;
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: join(screenshotDirectory, `${name}.png`), fullPage: true });
}

async function queuedFeedback(userId: string): Promise<QueuedFeedback[]> {
  const rows = await query(
    `select data->'data' from pgboss.job where name = 'email.send' and data->>'template' = 'creator-feedback' and data->>'to' = '${contactEmail}' and data->'data'->>'userId' = '${userId}' order by created_on`,
  );
  return rows.map((row) => JSON.parse(row[0] ?? "null") as QueuedFeedback);
}

async function feedbackRows(userId: string): Promise<string[][]> {
  return query(
    `select kind, topic, status, coalesce(score::text, ''), coalesce(reason::text, '') from creator_feedback where user_id = '${userId}' order by created_at`,
  );
}

async function momentCard(page: Page, slug: string): Promise<Locator> {
  const card = page.getByRole("region", { name: question });
  await expect(async () => {
    await page.goto(`/c/${slug}`);
    await expect(card).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000, intervals: [2_000, 5_000] });
  return card;
}

for (const view of ["desktop", "mobile"] as const) {
  test(`a Cloud creator answers the first post question on the feed (${view})`, async ({
    actor,
  }) => {
    test.slow();
    const owner = await actor("Fern", { [view]: true });
    const userId = await userIdOf(owner.person.email);
    const slug = await createCommunity(owner.page, `First words ${uniqueSuffix()}`, "public");
    await writePost(owner.page, slug, `Hello from ${slug}`);

    const card = await momentCard(owner.page, slug);
    await expect(card.getByText("Very hard", { exact: true })).toBeVisible();
    await expect(card.getByText("Very easy", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Send" })).toBeDisabled();
    await card.getByText("4", { exact: true }).click();
    await card
      .getByLabel("What would have made it easier? (optional)")
      .fill("A sample post to copy.");
    if (view === "mobile") await expectNoHorizontalScroll(owner.page);
    await expectAccessible(owner.page, `moment question (${view})`);
    await screenshot(owner.page, `moment-card-${view}`);
    await card.getByRole("button", { name: "Send" }).click();
    await expect(owner.page.getByText("Thanks. We read every answer.")).toBeVisible();

    await expect.poll(async () => (await queuedFeedback(userId)).length, poll).toBe(1);
    const [email] = await queuedFeedback(userId);
    expect(email).toEqual(
      expect.objectContaining({
        kind: "moment",
        topic: "First post",
        score: 4,
        comment: "A sample post to copy.",
        userId,
        communitySlug: slug,
      }),
    );
    expect(await feedbackRows(userId)).toEqual([["moment", "first_post", "answered", "4", ""]]);

    await owner.page.goto(`/c/${slug}`);
    await expect(owner.page.getByRole("region", { name: question })).toHaveCount(0);
  });

  test(`an owner archives a community and gives a reason (${view})`, async ({ actor }) => {
    const owner = await actor("Ines", { [view]: true });
    const userId = await userIdOf(owner.person.email);
    const slug = await createCommunity(owner.page, `Winding down ${uniqueSuffix()}`, "public");

    const archive = await openArchiveDialog(owner.page, slug);
    const reasons = archive.dialog.getByRole("group", {
      name: "Why are you archiving? (optional)",
    });
    await expect(reasons).toBeVisible();
    await reasons.getByLabel("Reason").selectOption({ label: "Not enough members or activity" });
    await reasons.getByLabel("Anything else to tell us?").fill("Moving to a smaller group.");
    if (view === "mobile") await expectNoHorizontalScroll(owner.page);
    await expectAccessible(owner.page, `archive dialog with reasons (${view})`);
    await screenshot(owner.page, `archive-reason-${view}`);
    await archive.confirm();

    await expect.poll(async () => (await queuedFeedback(userId)).length, poll).toBe(1);
    const [email] = await queuedFeedback(userId);
    expect(email).toEqual(
      expect.objectContaining({
        kind: "exit",
        topic: "Archived a community",
        reason: "Not enough members or activity",
        comment: "Moving to a smaller group.",
        userId,
        communitySlug: slug,
      }),
    );
    expect(await feedbackRows(userId)).toEqual([
      ["exit", "archive_community", "answered", "", "not_enough_activity"],
    ]);
  });
}

test("a creator dismisses the question for good and turns it back on in Account", async ({
  actor,
}) => {
  test.slow();
  const owner = await actor("Gus", { desktop: true });
  const userId = await userIdOf(owner.person.email);
  const slug = await createCommunity(owner.page, `Quiet start ${uniqueSuffix()}`, "public");
  await writePost(owner.page, slug, `First note in ${slug}`);

  const card = await momentCard(owner.page, slug);
  await card.getByRole("button", { name: "Don't ask me again" }).click();
  await expect(card).toHaveCount(0);
  expect(await feedbackRows(userId)).toEqual([["moment", "first_post", "dismissed", "", ""]]);
  expect(await queuedFeedback(userId)).toEqual([]);

  await owner.page.goto("/account/notifications");
  const setting = owner.page.getByRole("switch", { name: "Ask me how setup went" });
  await expect(setting).not.toBeChecked();
  const slowSave = 1_500;
  await owner.page.route("**/account/notifications", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise((resolve) => setTimeout(resolve, slowSave));
    }
    await route.continue();
  });
  await setting.click();
  await expect(setting).toBeChecked();
  const saveStatus = owner.page.getByRole("status").filter({ hasText: /^Sav/ });
  await expect(saveStatus).toHaveText("Saving…");
  await expect(setting).toBeDisabled();
  await expect(saveStatus).toHaveText("Saved.");
  await owner.page.unroute("**/account/notifications");
  await owner.page.reload();
  await expect(owner.page.getByRole("switch", { name: "Ask me how setup went" })).toBeChecked();
});

test("an owner archives without a reason and nothing is stored or sent", async ({ actor }) => {
  const owner = await actor("Hal", { desktop: true });
  const userId = await userIdOf(owner.person.email);
  const slug = await createCommunity(owner.page, `No reason ${uniqueSuffix()}`, "public");

  const archive = await openArchiveDialog(owner.page, slug);
  await archive.confirm();

  expect(await feedbackRows(userId)).toEqual([]);
  expect(await queuedFeedback(userId)).toEqual([]);
});
