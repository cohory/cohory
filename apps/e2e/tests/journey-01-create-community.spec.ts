import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { password, uniqueSuffix } from "../support/people";
import { createCommunity, expectSections } from "../pages/community";

test("journey 1: a creator signs up and creates a community", async ({ actor }) => {
  const owner = await actor("Ada", { signedIn: false });
  const { page } = owner;
  const name = `Journey one ${uniqueSuffix()}`;

  await test.step("sign up from the home page and land on the create form", async () => {
    await page.goto("/");
    await page
      .getByRole("main")
      .getByRole("link", { name: "Create your community" })
      .first()
      .click();
    await expect(page.getByText("Create your account, then name your community.")).toBeVisible();
    await expectAccessible(page, "sign up");
    await page.getByLabel("Name").fill(owner.person.name);
    await page.getByLabel("Email").fill(owner.person.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/communities/new", {
      timeout: 30_000,
    });
  });

  const slug = await test.step("create a public community", async () => {
    await expectAccessible(page, "new community");
    return createCommunity(page, name, "public");
  });

  await test.step("the community home shows four sections and Manage", async () => {
    await expect(page.getByRole("heading", { name }).first()).toBeVisible();
    await expectSections(page, ["Community", "Classroom", "Calendar", "Members"]);
    await expect(page.getByRole("link", { name: "Manage" }).first()).toBeVisible();
    await expectAccessible(page, "community home (owner)");
  });

  await test.step("Members lists the creator as owner", async () => {
    await page.goto(`/c/${slug}/members`);
    const card = page
      .getByRole("list", { name: "Members" })
      .getByRole("listitem")
      .filter({ hasText: owner.person.name });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("Creator");
    await expectAccessible(page, "members (owner)");
  });

  await test.step("Manage overview opens for the owner", async () => {
    await page.goto(`/c/${slug}/manage`);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expectAccessible(page, "manage overview");
  });

  await test.step("the community is listed on My communities", async () => {
    await page.goto("/");
    await expect(page).toHaveURL((url) => url.pathname === `/c/${slug}`);
    await page.goto("/?home=1");
    await expect(page.getByRole("heading", { name: "My communities" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(name) }).first()).toBeVisible();
  });
});
