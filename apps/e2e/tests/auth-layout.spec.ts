import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";

const authPages = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password"] as const;
const viewports = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
] as const;

test("auth pages keep the logo a short distance above the card and both in view", async ({
  actor,
}) => {
  const { page } = await actor("Lena", { desktop: true, signedIn: false });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const path of authPages) {
      await test.step(`${path} at ${viewport.width}x${viewport.height}`, async () => {
        await page.goto(path);
        const logo = await page.getByRole("banner").getByRole("link").boundingBox();
        const card = await page.getByRole("main").locator('[data-slot="card"]').boundingBox();
        expect(logo).not.toBeNull();
        expect(card).not.toBeNull();
        if (!logo || !card) return;
        const gap = card.y - (logo.y + logo.height);
        expect(gap, "gap between logo and card").toBeGreaterThanOrEqual(16);
        expect(gap, "gap between logo and card").toBeLessThanOrEqual(48);
        expect(logo.y).toBeGreaterThanOrEqual(0);
        expect(card.y).toBeLessThan(viewport.height);
        expect(logo.x).toBeGreaterThanOrEqual(0);
        expect(logo.x + logo.width).toBeLessThanOrEqual(viewport.width);
        expect(card.x + card.width).toBeLessThanOrEqual(viewport.width);
      });
    }
    await page.goto("/sign-in");
    await expectAccessible(page, `/sign-in at ${viewport.width}`);
  }
});
