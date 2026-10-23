import type { Page } from "@playwright/test";

import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { password, uniqueSuffix, type Person } from "../support/people";
import { addLesson, createCourse, publishCourse } from "../pages/classroom";
import {
  createCommunity,
  expectBottomNavigation,
  expectNoHorizontalScroll,
  joinCommunity,
  sectionNav,
  expectSections,
} from "../pages/community";
import { settle, writePost } from "../pages/feed";
import { connectStripeAndSavePlan, saveJoinSettings } from "../pages/manage";
import { stubStripePages } from "../pages/reviews";

const visitorTabs = [
  "About",
  "Community",
  "Classroom, for members",
  "Calendar",
  "Members, for members",
];
const memberTabs = ["Community", "Classroom", "Calendar", "Members"];

async function createAccountOnSignUp(
  page: Page,
  who: Person,
  line: string | RegExp = /^Create your account( to join|, then ask to join) /,
): Promise<void> {
  await expect(page).toHaveURL((url) => url.pathname === "/sign-up");
  await expect(page.getByText(line)).toBeVisible();
  await page.getByLabel("Name").fill(who.name);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
}

test("step 17c: a visitor lands on About, sees locked sections, and joins after sign up", async ({
  actor,
}) => {
  test.slow();
  const owner = await actor("Petra", { desktop: true });
  const name = `Clay club ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "public");
  const courseTitle = `Secret glazes ${uniqueSuffix()}`;
  const postText = `Kiln opens on Friday ${uniqueSuffix()}`;

  await test.step("the owner publishes a course and writes a post", async () => {
    const course = await createCourse(owner.page, slug, courseTitle);
    await addLesson(owner.page, slug, course, "Module 1", { title: "First glaze" });
    await publishCourse(owner.page, slug, course);
    await writePost(owner.page, slug, postText);
  });

  const visitor = await actor("Vik", { desktop: true, signedIn: false });
  const page = visitor.page;

  await test.step("a signed out visitor lands on About with the navbar, About first", async () => {
    await page.goto(`/c/${slug}`);
    await expect(page).toHaveURL((url) => url.pathname === `/c/${slug}/about`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("By Petra")).toBeVisible();
    await expectSections(page, visitorTabs);
    await expect(sectionNav(page).getByRole("link", { name: "About" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("heading", { name: `About ${name}` })).toHaveCount(0);
    await expect(page.getByText("Admins")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Community details" })).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Courses" }).getByText(courseTitle),
    ).toBeVisible();
    await expect(page.getByText("First glaze")).toHaveCount(0);
    const banner = page.getByRole("banner");
    await expect(banner.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(banner.getByRole("searchbox", { name: "Search this community" })).toBeVisible();
    await expect(banner.getByRole("button", { name: "Switch community" })).toHaveCount(0);
    await expectAccessible(page, "about, public, signed out (1280)");
  });

  await test.step("the feed stays readable from the Community tab", async () => {
    await sectionNav(page).getByRole("link", { name: "Community" }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/c/${slug}/feed`);
    await expect(page.getByText(postText)).toBeVisible();
  });

  await test.step("Classroom and Members show a join prompt without their content", async () => {
    await sectionNav(page)
      .getByRole("link", { name: /^Classroom/ })
      .click();
    await expect(page).toHaveURL((url) => url.pathname === `/c/${slug}/classroom`);
    const classroom = page.getByRole("region", { name: "Classroom" });
    await expect(
      classroom.getByText("1 course for members. Join to start learning."),
    ).toBeVisible();
    await expect(classroom.getByRole("button", { name: "Join community" })).toBeVisible();
    const course = classroom.getByRole("listitem").filter({ hasText: courseTitle });
    await expect(course.getByText(/^\d+ lessons?$/)).toBeVisible();
    await expect(classroom.getByRole("link", { name: courseTitle })).toHaveCount(0);
    await expect(page.getByText("First glaze")).toHaveCount(0);

    await sectionNav(page)
      .getByRole("link", { name: /^Members/ })
      .click();
    const members = page.getByRole("region", { name: "Members" });
    await expect(members.getByText("1 member is here. Join to see who they are.")).toBeVisible();
    await expect(members.getByText("Petra")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Leaderboard" })).toHaveCount(0);
    await expectAccessible(page, "locked members (1280)");
  });

  await test.step("Join while signed out creates the account and lands on the feed", async () => {
    await page.goto(`/c/${slug}/about`);
    await page.getByRole("button", { name: "Join community" }).first().click();
    await createAccountOnSignUp(page, visitor.person);
    await expect(page).toHaveURL((url) => url.pathname === `/c/${slug}`, { timeout: 30_000 });
    await expectSections(page, memberTabs);
    await expect(page.getByRole("button", { name: "Join community" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  });

  await test.step("an existing account can switch to sign in and keep the intent", async () => {
    const known = await actor("Kai", { signedIn: true });
    const fresh = await actor("Kai-visitor", { desktop: true, signedIn: false });
    await fresh.page.goto(`/c/${slug}/about`);
    await fresh.page.getByRole("button", { name: "Join community" }).first().click();
    await expect(fresh.page).toHaveURL((url) => url.pathname === "/sign-up");
    await fresh.page.getByRole("link", { name: "Sign in" }).last().click();
    await expect(fresh.page).toHaveURL(
      (url) =>
        url.pathname === "/sign-in" &&
        url.searchParams.get("next") === `/c/${slug}/join?intent=join`,
    );
    await fresh.page.getByLabel("Email").fill(known.person.email);
    await fresh.page.getByLabel("Password", { exact: true }).fill(password);
    await fresh.page.getByRole("button", { name: "Sign in" }).click();
    await expect(fresh.page).toHaveURL((url) => url.pathname === `/c/${slug}`, { timeout: 30_000 });
    await expectSections(fresh.page, memberTabs);
  });

  await test.step("a continuation link that did not start from Join does nothing", async () => {
    const outsider = await actor("Ola", { desktop: true });
    await outsider.page.goto(`/c/${slug}/join?intent=join`);
    await expect(outsider.page).toHaveURL((url) => url.pathname === `/c/${slug}/about`);
    await expect(
      outsider.page.getByRole("button", { name: "Join community" }).first(),
    ).toBeVisible();
    await outsider.page.goto(`/c/${slug}/join?intent=admin`);
    await expect(outsider.page).toHaveURL((url) => url.pathname === "/");
  });

  await test.step("sign up ignores a return target on another site", async () => {
    const stranger = await actor("Sam", { desktop: true, signedIn: false });
    await stranger.page.goto(`/sign-up?next=${encodeURIComponent("https://evil.example/steal")}`);
    await stranger.page.getByLabel("Name").fill(stranger.person.name);
    await stranger.page.getByLabel("Email").fill(stranger.person.email);
    await stranger.page.getByLabel("Password", { exact: true }).fill(password);
    await stranger.page.getByRole("button", { name: "Create account" }).click();
    await expect(stranger.page).toHaveURL(
      (url) => url.pathname === "/" && url.host !== "evil.example",
    );
  });

  await test.step("the About page and locked Classroom work on a phone", async () => {
    const phone = await actor("Pia", { mobile: true, signedIn: false });
    await phone.page.goto(`/c/${slug}`);
    await expect(phone.page).toHaveURL((url) => url.pathname === `/c/${slug}/about`);
    const join = phone.page.getByRole("button", { name: "Join community" }).first();
    await expect(join).toBeInViewport();
    const box = await join.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(340);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(sectionNav(phone.page).getByRole("link")).toHaveCount(5);
    await expectNoHorizontalScroll(phone.page);
    await expectAccessible(phone.page, "about, public, signed out (390)");
    await phone.page.goto(`/c/${slug}/classroom`);
    await expect(phone.page.getByRole("region", { name: "Classroom" })).toBeVisible();
    await expectNoHorizontalScroll(phone.page);
  });
});

test("step 17c: a paid community starts checkout and a request to join opens the questions after sign up", async ({
  actor,
}) => {
  test.slow();
  const owner = await actor("Rhea", { desktop: true });
  const paidSlug = await createCommunity(owner.page, `Paid studio ${uniqueSuffix()}`, "public");
  await connectStripeAndSavePlan(owner.page, paidSlug);
  const askSlug = await createCommunity(owner.page, `Ask first ${uniqueSuffix()}`, "public");
  await saveJoinSettings(owner.page, askSlug, {
    mode: "Approval",
    questions: ["What do you make?"],
  });

  await test.step("Join for a price while signed out goes to sign up, then to checkout", async () => {
    const buyer = await actor("Bo", { desktop: true, signedIn: false });
    await stubStripePages(buyer.context);
    await buyer.page.goto(`/c/${paidSlug}`);
    await buyer.page.getByRole("button", { name: "Join for $29.00/month" }).first().click();
    const checkout = buyer.page.waitForRequest(/^https:\/\/checkout\.stripe\.test\/pay\/cs_/, {
      timeout: 30_000,
    });
    await createAccountOnSignUp(
      buyer.page,
      buyer.person,
      /^Create your account, then pay \$29\.00\/month with Stripe to join Paid studio .+\. Cancel anytime\.$/,
    );
    const request = await checkout;
    expect(request.redirectedFrom()?.url()).toContain(`/c/${paidSlug}/join?intent=checkout`);
  });

  await test.step("Request to join while signed out opens the questions after sign up", async () => {
    const asker = await actor("Ari", { desktop: true, signedIn: false });
    await asker.page.goto(`/c/${askSlug}`);
    await asker.page.getByRole("button", { name: "Request to join" }).first().click();
    await createAccountOnSignUp(asker.page, asker.person);
    await expect(asker.page).toHaveURL(
      (url) => url.pathname === `/c/${askSlug}/about` && url.searchParams.get("join") === "request",
      { timeout: 30_000 },
    );
    const dialog = asker.page.getByRole("dialog");
    await dialog.getByLabel("What do you make?").fill("Stoneware mugs and bowls.");
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(asker.page.getByText("Request pending")).toBeVisible({ timeout: 30_000 });
  });
});

test("step 17c: private visitors see only About, members get a slim top, owners preview About", async ({
  actor,
}) => {
  test.slow();
  const owner = await actor("Iris", { desktop: true });
  const name = `Quiet room ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "private");
  const publicSlug = await createCommunity(owner.page, `Busy room ${uniqueSuffix()}`, "public");

  await test.step("a private community shows a non-member only the About page", async () => {
    const visitor = await actor("Nia", { desktop: true });
    await visitor.page.goto(`/c/${slug}`);
    await expect(visitor.page).toHaveURL((url) => url.pathname === `/c/${slug}/about`);
    await expect(visitor.page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expectSections(visitor.page, []);
    await expect(
      visitor.page.getByRole("banner").getByRole("searchbox", { name: "Search this community" }),
    ).toHaveCount(0);
    await expectAccessible(visitor.page, "about, private (1280)");
    await visitor.page.goto(`/c/${slug}/classroom`);
    await expect(visitor.page).toHaveURL((url) => url.pathname === `/c/${slug}/about`);
    const phone = await actor("Noa", { mobile: true, signedIn: false });
    await phone.page.goto(`/c/${slug}`);
    await expectSections(phone.page, []);
    await expectNoHorizontalScroll(phone.page);
    await expectAccessible(phone.page, "about, private (390)");
  });

  await test.step("a member sees a slim top with four tabs and no About tab", async () => {
    const member = await actor("Milo", { desktop: true });
    await joinCommunity(member.page, publicSlug);
    await member.page.goto(`/c/${publicSlug}`);
    await expectSections(member.page, memberTabs);
    await expect(member.page.locator("#community-name")).toHaveCount(0);
    await expect(member.page.getByRole("button", { name: "More community options" })).toBeVisible();
    await expect(member.page.getByRole("link", { name: "Manage" })).toHaveCount(0);
    await expectAccessible(member.page, "feed as member (1280)");
    await member.page.setViewportSize({ width: 390, height: 844 });
    await member.page.reload();
    await expectBottomNavigation(member.page);
    await expectNoHorizontalScroll(member.page);
    await expectAccessible(member.page, "feed as member (390)");

    await test.step("the phone search opens a dialog that searches this community", async () => {
      await member.page.getByRole("button", { name: "Search this community" }).click();
      const dialog = member.page.getByRole("dialog", { name: "Search" });
      await dialog.getByRole("searchbox", { name: "Search this community" }).fill("welcome");
      await dialog.getByRole("button", { name: "Search", exact: true }).click();
      await expect(member.page).toHaveURL(
        (url) =>
          url.pathname === `/c/${publicSlug}/search` && url.searchParams.get("q") === "welcome",
      );
    });
  });

  await test.step("the account menu holds account links, your communities, and sign out", async () => {
    await owner.page.goto(`/c/${publicSlug}`);
    await owner.page.getByRole("button", { name: /^Open account menu for / }).click();
    const items = owner.page.getByRole("menuitem");
    await expect(items.first()).toHaveText("Account");
    const texts = (await items.allInnerTexts()).map((text) => text.trim().replace(/\s+/g, " "));
    expect(texts[1]).toBe("Notification settings");
    expect(texts[2]).toBe("Billing");
    expect(texts[3]).toBe("Home");
    expect(texts.at(-3)).toBe("Create a community");
    expect(texts.at(-2)).toBe("Send feedback");
    expect(texts.at(-1)).toBe("Sign out");
    expect(texts.some((text) => text.startsWith("Q") && text.includes(name))).toBe(true);
    await expectAccessible(owner.page, "header menu open (1280)");
    await owner.page.keyboard.press("Escape");
  });

  await test.step("the owner previews About from Manage, Appearance", async () => {
    await owner.page.goto(`/c/${publicSlug}/manage/appearance`);
    await settle(owner.page);
    await owner.page.getByRole("link", { name: "View About page" }).click();
    await expect(owner.page).toHaveURL(
      (url) => url.pathname === `/c/${publicSlug}/about` && url.searchParams.get("preview") === "1",
    );
    const banner = owner.page.getByRole("status").filter({ hasText: "Preview." });
    await expect(banner).toBeVisible();
    await expect(
      banner.getByRole("list", { name: "Missing from this page" }).getByRole("link", {
        name: "Cover image",
      }),
    ).toHaveAttribute("href", `/c/${publicSlug}/manage/appearance`);
    await expect(owner.page.locator("#community-name")).toBeVisible();
    await expect(owner.page.getByRole("button", { name: "Join community" }).first()).toBeVisible();
    await expectSections(owner.page, visitorTabs);
    await expectAccessible(owner.page, "about preview (1280)");
    await owner.page.goto(`/c/${publicSlug}/about`);
    await expect(owner.page.getByRole("status").filter({ hasText: "Preview." })).toHaveCount(0);
    await expectSections(owner.page, memberTabs);
    await expect(owner.page.getByRole("link", { name: "Manage" })).toBeVisible();
  });
});
