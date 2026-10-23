import { expect, test } from "../support/fixtures";

const pages = [
  ["/terms", "Terms of Service"],
  ["/privacy", "Privacy Policy"],
  ["/guidelines", "Community Guidelines"],
  ["/legal/creator-terms", "Creator Terms"],
  ["/legal/dpa", "Data Processing Agreement"],
] as const;

test("legal pages show when they were last updated and no draft notice", async ({ actor }) => {
  const { page } = await actor("Lena", { desktop: true, signedIn: false });
  for (const [path, title] of pages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText(/^Last updated \d{1,2} [A-Z][a-z]+ \d{4}$/)).toBeVisible();
    await expect(page.getByText(/Draft for legal review/)).toHaveCount(0);
    await expect(page.getByText(/^Version \S+$/)).toHaveCount(0);
  }
});
