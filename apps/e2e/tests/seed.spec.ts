import type { Locator } from "@playwright/test";

import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { signInThroughUi } from "../pages/auth";
import { sectionLinks } from "../pages/community";
import { posts } from "../pages/feed";

const seededOwner = { email: "owner@cohory.local", password: "cohory-dev-password" };

async function expectLoaded(image: Locator): Promise<void> {
  await expect(image).toBeVisible();
  expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(
    0,
  );
}

test("the seeded owner signs in and finds Cohory Creators with its categories, pinned posts, and course", async ({
  actor,
}) => {
  const { page } = await actor("Seed", { signedIn: false });
  await page.goto("/sign-in");
  await expectAccessible(page, "sign in");
  await signInThroughUi(page, seededOwner.email, seededOwner.password);
  await page.goto("/c/cohory-creators");
  await expect(page.getByRole("heading", { name: "Cohory Creators" }).first()).toBeVisible();
  await expect(sectionLinks(page)).toHaveCount(4);
  await expect(page.getByRole("link", { name: "Manage" }).first()).toBeVisible();
  await expectLoaded(page.locator('img[src*="/branding/logo-"]').first());
  await expect(
    page.getByRole("navigation", { name: "Filter by category" }).getByRole("link"),
  ).toHaveText([
    "All",
    "Introductions",
    "Ideas and feedback",
    "Questions",
    "Wins",
    "Announcements",
    "Bugs",
  ]);
  await expect(posts(page).nth(0)).toContainText("Welcome to Cohory Creators");
  await expect(posts(page).nth(0)).toContainText("Pinned");
  await expect(posts(page).nth(1)).toContainText("Roadmap: now, next, later");
  await expect(posts(page).nth(1)).toContainText("Pinned");
  await expectAccessible(page, "seeded community home");

  await page.goto("/c/cohory-creators/classroom/how-to-use-cohory-classroom");
  await expect(
    page.getByRole("heading", { name: "How to use Cohory Classroom" }).first(),
  ).toBeVisible();
  await expect(page.getByText("Work with AI agents").first()).toBeVisible();
  await expectAccessible(page, "seeded course");
});

test("a visitor sees the private Cohory Creators About page with its cover, gallery, and join request", async ({
  actor,
}) => {
  const { page } = await actor("Seed visitor", { signedIn: false });
  await page.goto("/c/cohory-creators");
  await expect(page.getByRole("heading", { name: "Cohory Creators" }).first()).toBeVisible();
  await expect(page.getByText(/^Private\W+\d+ members/).first()).toBeVisible();
  await expectLoaded(page.locator('img[src*="/branding/cover-"]').first());
  const gallery = page.getByRole("region", { name: "Gallery" });
  await expect(
    gallery.getByRole("list", { name: "Gallery items" }).getByRole("button"),
  ).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Request to join" }).first()).toBeVisible();
  await expect(posts(page)).toHaveCount(0);
  await expectAccessible(page, "seeded private About page");
});

test("the seeded Cohory Pro shows its price on the About page and opens from its invite link", async ({
  actor,
}) => {
  const { page } = await actor("Seed user", { signedIn: false });
  await signInThroughUi(page, "user@cohory.local", seededOwner.password);
  await page.goto("/c/cohory-pro");
  await expect(page.getByRole("heading", { name: "Cohory Pro" }).first()).toBeVisible();
  await expect(page.getByText(/^Private\W+\d+ members/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Join for $19.00/month" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Yearly $190.00" }).first()).toBeVisible();
  await expectLoaded(page.locator('img[src*="/branding/cover-"]').first());
  await expectAccessible(page, "seeded paid About page");

  await page.goto("/join/cohory-pro-invite-link-for-local-paid-tests");
  await expect(page.getByText("You're invited to Cohory Pro")).toBeVisible();
  await expectAccessible(page, "seeded paid community invite");
});
