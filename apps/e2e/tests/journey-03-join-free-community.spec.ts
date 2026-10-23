import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { signUpThroughUi } from "../pages/auth";
import { settle } from "../pages/feed";
import {
  createCommunity,
  expectBottomNavigation,
  expectNoHorizontalScroll,
  joinCommunity,
  requestToJoin,
  expectSections,
  sectionLinks,
} from "../pages/community";

test("journey 3: a member discovers and joins a free community", async ({ actor, isMobile }) => {
  const owner = await actor("Olga", { desktop: true });
  const publicName = `Open garden ${uniqueSuffix()}`;
  const privateName = `Quiet room ${uniqueSuffix()}`;
  const publicSlug = await createCommunity(owner.page, publicName, "public");
  const privateSlug = await createCommunity(owner.page, privateName, "private");

  const member = await actor("Bea", { signedIn: false });
  const { page } = member;

  await test.step("sign up through the form", async () => {
    await signUpThroughUi(page, member.person);
  });

  await test.step("a public community shows Join and no Manage", async () => {
    await page.goto(`/c/${publicSlug}`);
    await expect(page.getByRole("heading", { name: publicName }).first()).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: publicName, exact: true })
        .getByRole("button", { name: "Join community" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Manage" })).toHaveCount(0);
    await expectAccessible(page, "public community before joining");
  });

  await test.step("joining shows the four sections", async () => {
    await joinCommunity(page, publicSlug);
    await page.reload();
    await expect(sectionLinks(page)).toHaveCount(4);
    await expect(page.getByRole("link", { name: "Manage" })).toHaveCount(0);
    if (isMobile) {
      await expectBottomNavigation(page);
      await expectNoHorizontalScroll(page);
    }
    await expectAccessible(page, "community home (member)");
  });

  await test.step("Members lists the new member", async () => {
    await page.goto(`/c/${publicSlug}/members`);
    await expect(
      page
        .getByRole("list", { name: "Members" })
        .getByRole("listitem")
        .filter({ hasText: member.person.name }),
    ).toHaveCount(1);
    await expectAccessible(page, "members (member)");
  });

  await test.step("My communities lists the joined community", async () => {
    await page.goto("/?home=1");
    await expect(page.getByRole("link", { name: new RegExp(publicName) }).first()).toBeVisible();
    await expectAccessible(page, "my communities (member)");
  });

  await test.step("a private community shows only its About view", async () => {
    await page.goto(`/c/${privateSlug}`);
    await expect(page.getByRole("heading", { name: "About", exact: true })).toBeVisible();
    await expectSections(page, []);
    await expect(
      page
        .getByRole("region", { name: privateName, exact: true })
        .getByRole("button", { name: "Request to join" }),
    ).toBeEnabled();
    await expect(page.getByRole("link", { name: "Manage" })).toHaveCount(0);
    await expectAccessible(page, "private community about");
  });

  await test.step("the private Manage page sends a non member away", async () => {
    await page.goto(`/c/${privateSlug}/manage`);
    await expect(page).toHaveURL((url) => url.pathname === `/c/${privateSlug}/about`);
  });

  await test.step("the owner asks a join question", async () => {
    await owner.page.goto(`/c/${privateSlug}/manage/settings/joining`);
    await settle(owner.page);
    await owner.page.getByRole("button", { name: "Add a question" }).click();
    await owner.page.getByLabel("Question 1").fill("What brings you here?");
    await owner.page.getByRole("button", { name: "Save join settings" }).click();
    await expect(owner.page.getByText("Join settings saved.")).toBeVisible();
  });

  await test.step("a request to join waits for approval", async () => {
    await page.goto(`/c/${privateSlug}`);
    await settle(page);
    await requestToJoin(page, { "What brings you here? (optional)": "Quiet reading" });
    await expect(page.getByText("Request pending")).toBeVisible({ timeout: 30_000 });
    await expectSections(page, []);
    await expectAccessible(page, "private community about (request pending)");
  });

  await test.step("the owner approves the request and the member gets in", async () => {
    await owner.page.goto(`/c/${privateSlug}/manage/people?tab=requests`);
    await settle(owner.page);
    const request = owner.page.getByRole("listitem", {
      name: `Request from ${member.person.name}`,
    });
    await expect(request.getByText("Quiet reading")).toBeVisible();
    await expectAccessible(owner.page, "manage people requests");
    await request.getByRole("button", { name: `Approve ${member.person.name}` }).click();
    await expect(request).toHaveCount(0, { timeout: 30_000 });
    await page.goto(`/c/${privateSlug}`);
    await expect(sectionLinks(page)).toHaveCount(4);
  });
});
