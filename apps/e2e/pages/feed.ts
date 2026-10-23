import { expect, type Locator, type Page } from "@playwright/test";

export const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

export function posts(page: Page): Locator {
  return page.locator('article[data-slot="community-post"]');
}

export async function writePost(
  page: Page,
  slug: string,
  text: string,
  options: { image?: boolean } = {},
): Promise<string> {
  await page.goto(`/c/${slug}`);
  await page.getByRole("button", { name: "Write something" }).click();
  const composer = page.getByRole("group", { name: "New post" });
  await composer.getByRole("textbox", { name: "Write something" }).fill(text);
  if (options.image) {
    await composer
      .locator('input[type="file"]')
      .setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: onePixelPng });
    await expect(
      composer.getByRole("list", { name: "Attached images" }).getByRole("listitem"),
    ).toHaveCount(1);
    await expect(composer.getByText(/^Uploading /)).toHaveCount(0, { timeout: 30_000 });
  }
  await composer.getByRole("button", { name: "Post", exact: true }).click();
  const article = posts(page)
    .filter({ hasText: text.split("**").join("").split(" http")[0] ?? text })
    .first();
  await expect(article).toBeVisible({ timeout: 30_000 });
  const href = await article.locator('a[href*="/posts/"]').first().getAttribute("href");
  expect(href, "post link").toBeTruthy();
  return href ?? "";
}

export function likeButton(page: Page): Locator {
  return posts(page).first().locator('button[data-slot="like-button"]');
}

// Typing into a controlled field or clicking a client-side menu before React hydrates it loses
// the input, and no web-first assertion can see that. React tags each hydrated element with a
// `__reactProps$` key. Server action forms add hidden inputs React never hydrates, and markup set
// through dangerouslySetInnerHTML is not React's to hydrate.
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const propsOf = (node: Element): unknown => {
        const key = Object.keys(node).find((name) => name.startsWith("__reactProps$"));
        return key === undefined ? undefined : Reflect.get(node, key);
      };
      const hydrated = (element: Element): boolean => {
        for (let node: Element | null = element; node; node = node.parentElement) {
          const props = propsOf(node);
          if (props === undefined) continue;
          return (
            node === element ||
            (typeof props === "object" && props !== null && "dangerouslySetInnerHTML" in props)
          );
        }
        return false;
      };
      return Array.from(
        document.querySelectorAll("button, input:not([type='hidden']), select, textarea"),
      ).every(hydrated);
    },
    undefined,
    { timeout: 30_000 },
  );
}

export async function setLiked(page: Page, postPath: string, liked: boolean): Promise<void> {
  await page.goto(postPath);
  await settle(page);
  const like = likeButton(page);
  await expect(like).toHaveAttribute("aria-pressed", String(!liked));
  const saved = page.waitForResponse((response) => response.request().method() === "POST");
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", String(liked));
  expect((await saved).ok(), "like request succeeded").toBe(true);
  await page.reload();
  await expect(likeButton(page)).toHaveAttribute("aria-pressed", String(liked));
}

export function bell(page: Page): Locator {
  return page.locator('button[aria-label^="Notifications"]').filter({ visible: true }).first();
}

export async function expectUnread(page: Page, path: string, count: number): Promise<void> {
  await expect(async () => {
    await page.goto(path);
    await expect(bell(page)).toHaveAttribute("aria-label", `Notifications, ${count} unread`, {
      timeout: 2_000,
    });
  }).toPass({ timeout: 90_000, intervals: [1_000, 2_000, 3_000, 5_000] });
}

export async function writePostInCategory(
  page: Page,
  slug: string,
  text: string,
  category: string,
): Promise<void> {
  await page.goto(`/c/${slug}`);
  await page.getByRole("button", { name: "Write something" }).click();
  const composer = page.getByRole("group", { name: "New post" });
  await composer.getByRole("textbox", { name: "Write something" }).fill(text);
  await composer.getByLabel("Category").selectOption({ label: category });
  await composer.getByRole("button", { name: "Post", exact: true }).click();
  await expect(posts(page).filter({ hasText: text }).first()).toBeVisible({ timeout: 30_000 });
}

export async function composerCategories(page: Page, slug: string): Promise<string[]> {
  await page.goto(`/c/${slug}`);
  await page.getByRole("button", { name: "Write something" }).click();
  const composer = page.getByRole("group", { name: "New post" });
  return composer.getByLabel("Category").locator("option").allTextContents();
}

export async function writeComment(page: Page, postPath: string, text: string): Promise<void> {
  await page.goto(postPath);
  await settle(page);
  await page.getByRole("textbox", { name: "Write a comment" }).fill(text);
  await page
    .locator('[data-slot="comment-composer"]')
    .getByRole("button", { name: "Post", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: /^Comment by / }).filter({ hasText: text }),
  ).toHaveCount(1, { timeout: 30_000 });
}

export async function postMenuAction(page: Page, text: string, action: string): Promise<void> {
  await posts(page)
    .filter({ hasText: text })
    .first()
    .getByRole("button", { name: "Post options" })
    .click();
  await page.getByRole("menuitem", { name: action }).click();
}
