import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, expectNoHorizontalScroll } from "../pages/community";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("step 17: the header shows Cohory outside a community and the community inside one", async ({
  actor,
}) => {
  const owner = await actor("Hana", { desktop: true });
  const phone = await actor("Hiro", { mobile: true, signedIn: false });
  const name = `A community with a rather long name for the header ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "public");
  const banner = owner.page.getByRole("banner");

  await test.step("home with one community lands inside it", async () => {
    await owner.page.goto("/");
    await expect(owner.page).toHaveURL((url) => url.pathname === `/c/${slug}`);
  });

  await test.step("home shows the Cohory icon and wordmark and one link per community card", async () => {
    await owner.page.goto("/?home=1");
    await expect(owner.page).toHaveTitle("Cohory");
    await expect(banner.getByRole("link", { name: "Cohory", exact: true })).toBeVisible();
    await expect(banner.getByRole("link", { name: "Account" })).toHaveCount(0);
    await expect(owner.page.getByRole("link", { name: /^Open / })).toHaveCount(0);
    const card = owner.page.getByRole("main").getByRole("link", { name: new RegExp(`^${name}`) });
    await expect(card).toHaveAttribute("href", `/c/${slug}`);
    await expect(card.locator("a, button")).toHaveCount(0);
    await card.focus();
    await expect(card).toBeFocused();
    await expectAccessible(owner.page, "home with community cards");
    await owner.page.keyboard.press("Enter");
    await expect(owner.page).toHaveURL((url) => url.pathname === `/c/${slug}`);
  });

  await test.step("a community page shows its initial and name instead of the Cohory brand", async () => {
    const brand = banner.getByRole("link", { name, exact: true });
    await expect(brand).toHaveAttribute("href", `/c/${slug}`);
    await expect(brand.locator('[data-slot="community-mark"]')).toHaveText(name.charAt(0));
    await expect(banner.getByRole("link", { name: "Cohory", exact: true })).toHaveCount(0);
    await expect(banner.getByRole("button", { name: "Switch community" })).toHaveCount(0);
    await expect(banner.getByRole("button", { name: /^Open account menu for / })).toBeVisible();
    await expect(banner.getByRole("searchbox", { name: "Search this community" })).toBeVisible();
    await expect(owner.page).toHaveTitle(`${name} · Cohory`);
    await expectAccessible(owner.page, "community feed header");
  });

  await test.step("an uploaded logo replaces the initial in the header", async () => {
    await owner.page.goto(`/c/${slug}/manage/appearance`);
    await owner.page
      .getByLabel("Logo", { exact: true })
      .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: onePixelPng });
    await expect(owner.page.getByRole("button", { name: "Replace" }).first()).toBeVisible();
    await owner.page.goto(`/c/${slug}`);
    await expect(banner.getByRole("link", { name, exact: true }).locator("img")).toBeVisible();
    await expect(owner.page.locator("main img, #content img")).toHaveCount(0);
    await expect(owner.page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(owner.page.locator(`a[href="/c/${slug}/about"]`)).toHaveCount(0);
  });

  await test.step("the header fits a 390 wide screen on home and in the community", async () => {
    await owner.page.setViewportSize({ width: 390, height: 844 });
    await owner.page.goto("/?home=1");
    await expectNoHorizontalScroll(owner.page);
    await expectAccessible(owner.page, "home on a phone");
    await owner.page.goto(`/c/${slug}`);
    await expectNoHorizontalScroll(owner.page);
    const brandBox = await banner.getByRole("link", { name, exact: true }).boundingBox();
    expect(brandBox?.width ?? 0).toBeLessThan(390);
    await expectAccessible(owner.page, "community on a phone");
    await phone.page.goto("/");
    await expectNoHorizontalScroll(phone.page);
    await expect(
      phone.page.getByRole("banner").getByRole("link", { name: "Cohory" }),
    ).toBeVisible();
  });
});
