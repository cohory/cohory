import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { addLesson, createCourse, publishCourse } from "../pages/classroom";
import { createCommunity, joinCommunity } from "../pages/community";
import { settle } from "../pages/feed";

const markdown = [
  "## Welcome to the lesson",
  "",
  "- first point",
  "- second point",
  "",
  "```js",
  "const answer = 42;",
  "```",
  "",
  "<script>window.__pwned = 1;</script>",
  "",
  "[hostile link](javascript:window.__pwned=2)",
  "",
  "[safe link](https://example.com/)",
].join("\n");

test("journey 7: a creator builds a course with lessons", async ({ actor }) => {
  const owner = await actor("Ada");
  const { page } = owner;
  const slug = await createCommunity(page, `Classroom ${uniqueSuffix()}`, "public");
  const pdfName = `syllabus-${uniqueSuffix()}.pdf`;

  const courseSlug = await test.step("create a course from Classroom", async () => {
    await page.goto(`/c/${slug}/classroom`);
    await expectAccessible(page, "classroom empty (owner)");
    const created = await createCourse(page, slug, "Intro to cohory");
    await expect(page.getByText("Module 1").first()).toBeVisible();
    await expectAccessible(page, "course outline editor");
    return created;
  });

  const readingLesson = await test.step("add a markdown lesson with a PDF", async () => {
    const lesson = await addLesson(page, slug, courseSlug, "Module 1", {
      title: "Reading the docs",
      body: markdown,
      pdfName,
    });
    await expectAccessible(page, "lesson (owner)");
    return lesson;
  });

  await test.step("add a video lesson", async () => {
    await addLesson(page, slug, courseSlug, "Module 1", {
      title: "Watch the intro",
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
  });

  await test.step("publish the course", async () => {
    await publishCourse(page, slug, courseSlug, { announce: true });
    await expectAccessible(page, "course detail (owner)");
    await page.goto(`/c/${slug}`);
    await expect(page.getByText("New course: Intro to cohory").first()).toBeVisible();
  });

  await test.step("reorder lessons with the keyboard", async () => {
    await page.goto(`/c/${slug}/classroom/${courseSlug}?edit=1`);
    await settle(page);
    const announcer = page.locator('[data-slot="outline-editor-announcer"]');
    await page.getByRole("button", { name: "Reorder Watch the intro" }).focus();
    await page.keyboard.press("Space");
    await expect(announcer).toContainText("Picked up");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Space");
    await expect(announcer).toContainText("dropped");
    await expect(page.getByRole("button", { name: "Reorder Watch the intro" })).toBeFocused();
    await expect(async () => {
      await page.goto(`/c/${slug}/classroom/${courseSlug}`);
      const titles = (await page.locator('a[href*="/classroom/"]').allInnerTexts())
        .map((text) => text.trim())
        .filter((text) => /Watch the intro|Reading the docs/.test(text));
      expect(titles[0]).toContain("Watch the intro");
      expect(titles[1]).toContain("Reading the docs");
    }).toPass({ timeout: 20_000 });
  });

  await test.step("the creator previews the course as a member", async () => {
    await page.goto(`/c/${slug}/classroom/${courseSlug}`);
    await settle(page);
    await page.getByRole("button", { name: "Preview as member" }).click();
    await expect(page.getByRole("button", { name: "Exit preview" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit outline" })).toHaveCount(0);
    await page.getByRole("button", { name: "Exit preview" }).click();
    await expect(page.getByRole("button", { name: "Edit outline" })).toBeVisible();
  });

  await test.step("a member sees rendered and sanitized lesson content", async () => {
    const member = await actor("Bea");
    await joinCommunity(member.page, slug);
    await member.page.goto(`/c/${slug}/classroom/${courseSlug}/${readingLesson}`);
    const body = member.page.locator('[data-slot="lesson-body"]');
    await expect(body.locator("h2")).toHaveCount(1);
    await expect(body.locator("ul li")).toHaveCount(2);
    await expect(body.locator("pre code")).toHaveCount(1);
    await expect(body.locator("script")).toHaveCount(0);
    await expect(member.page.locator('a[href^="javascript:" i]')).toHaveCount(0);
    await expect(body.locator("a", { hasText: "safe link" })).toHaveAttribute("rel", /noopener/);
    expect(await member.page.evaluate(() => "__pwned" in window)).toBe(false);
    await expectAccessible(member.page, "lesson (member)");
  });

  await test.step("the member downloads the attachment", async () => {
    const member = await actor("Cal");
    await joinCommunity(member.page, slug);
    await member.page.goto(`/c/${slug}/classroom/${courseSlug}/${readingLesson}`);
    const link = member.page.locator("a[download]", { hasText: pdfName }).first();
    const href = await link.getAttribute("href");
    expect(href).toBeTruthy();
    const response = await member.context.request.get(href ?? "");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toContain(pdfName);
    expect(response.headers()["content-type"]).toContain("application/pdf");
  });

  await test.step("a member cannot open the editor", async () => {
    const member = await actor("Dan");
    await joinCommunity(member.page, slug);
    await member.page.goto(`/c/${slug}/classroom/${courseSlug}?edit=1`);
    await expect(member.page.getByRole("region", { name: "Edit outline" })).toHaveCount(0);
    await expect(member.page.getByRole("button", { name: "Publish course" })).toHaveCount(0);
    await expect(member.page.getByRole("button", { name: "Move to drafts" })).toHaveCount(0);
  });
});
