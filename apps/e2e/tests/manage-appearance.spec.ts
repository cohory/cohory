import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, joinCommunity } from "../pages/community";
import { saveAppearance, themeOf } from "../pages/manage";

test("manage appearance: creator theming reaches members and resets cleanly", async ({ actor }) => {
  const owner = await actor("Olga");
  const slug = await createCommunity(owner.page, `Looks ${uniqueSuffix()}`, "public");
  const member = await actor("Bea");
  await joinCommunity(member.page, slug);
  await member.page.goto(`/c/${slug}`);
  const baseline = await themeOf(member.page);

  await test.step("the Appearance page is accessible", async () => {
    await owner.page.goto(`/c/${slug}/manage/appearance`);
    await expect(owner.page.getByLabel("Hex code")).toBeVisible();
    await expectAccessible(owner.page, "manage appearance");
  });

  await test.step("dark, Source Serif, Soft, and a teal accent reach the member", async () => {
    await saveAppearance(owner.page, slug, {
      hex: "#0F766E",
      font: "Source Serif",
      cardStyle: "Soft",
      theme: "Dark",
    });
    await member.page.goto(`/c/${slug}`);
    const theme = await themeOf(member.page);
    expect(theme.theme).toBe("dark");
    expect(theme.cardStyle).toBe("soft");
    expect(theme.headingFont).toMatch(/Source Serif/);
    expect(theme.accent).not.toBe(baseline.accent);
    await expectAccessible(member.page, "themed community (dark)");
  });

  await test.step("light, Nunito Sans, and Minimal reach the member", async () => {
    await saveAppearance(owner.page, slug, {
      font: "Nunito Sans",
      cardStyle: "Minimal",
      theme: "Light",
    });
    await member.page.goto(`/c/${slug}`);
    const theme = await themeOf(member.page);
    expect(theme.theme).toBe("light");
    expect(theme.cardStyle).toBe("minimal");
    expect(theme.headingFont).toMatch(/Nunito Sans/);
    await expectAccessible(member.page, "themed community (light)");
  });

  await test.step("platform pages keep the default look", async () => {
    await member.page.goto("/account");
    await expect(member.page.getByRole("main")).toBeVisible();
    await expect(member.page.locator("[data-community-accent], [data-card-style]")).toHaveCount(0);
  });

  await test.step("an invalid hex code is refused", async () => {
    await owner.page.goto(`/c/${slug}/manage/appearance`);
    await owner.page.getByLabel("Hex code").fill("#GGGGGG");
    await owner.page.getByRole("button", { name: "Save appearance" }).click();
    await expect(owner.page.getByRole("alert").filter({ hasText: /color like/ })).toBeVisible();
    const response = await owner.context.request.patch(
      `/api/v1/communities/${slug}/manage/appearance`,
      {
        data: { accent: "#GGGGGG" },
      },
    );
    expect([400, 422]).toContain(response.status());
  });

  await test.step("reset returns the member page to the default", async () => {
    await saveAppearance(owner.page, slug, {
      hex: null,
      font: "Inter",
      cardStyle: "Minimal",
      theme: "System",
    });
    await member.page.goto(`/c/${slug}`);
    expect(await themeOf(member.page)).toEqual(baseline);
  });
});
