import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { addLesson, createCourse, publishCourse } from "../pages/classroom";
import { createCommunity, expectNoHorizontalScroll, joinCommunity } from "../pages/community";
import {
  composerCategories,
  postMenuAction,
  posts,
  setLiked,
  settle,
  writeComment,
  writePost,
  writePostInCategory,
} from "../pages/feed";

test("step 10 categories: staff only in the composer, chips, URL state, and ordering", async ({
  actor,
}) => {
  const owner = await actor("Olga", { desktop: true });
  const slug = await createCommunity(owner.page, `Studio ${uniqueSuffix()}`, "public");
  const member = await actor("Mia", { desktop: true });
  await joinCommunity(member.page, slug);

  await test.step("members cannot pick a staff only category", async () => {
    expect(await composerCategories(owner.page, slug)).toEqual([
      "No category",
      "General",
      "Introductions",
      "Announcements",
    ]);
    expect(await composerCategories(member.page, slug)).toEqual([
      "No category",
      "General",
      "Introductions",
    ]);
    await member.page.goto(`/c/${slug}?category=announcements`);
    await expect(
      member.page.getByText("Only staff can post in Announcements. Everyone can read and comment."),
    ).toBeVisible();
  });

  await test.step("posts land in their categories and the pinned one stays first", async () => {
    await writePostInCategory(owner.page, slug, "Welcome everyone", "Announcements");
    await postMenuAction(owner.page, "Welcome everyone", "Pin to top");
    await expect(owner.page.getByText("Post pinned.")).toBeVisible();
    await writePostInCategory(member.page, slug, "Hello from Mia", "Introductions");
    const kiln = await writePost(owner.page, slug, "Kiln schedule");
    await writeComment(owner.page, kiln, "Firing on Friday");
    await setLiked(member.page, kiln, true);
  });

  await test.step("chips filter the feed and keep the sort in the URL", async () => {
    await member.page.goto(`/c/${slug}`);
    await settle(member.page);
    const chips = member.page.getByRole("navigation", { name: "Filter by category" });
    await expect(chips.getByRole("link")).toHaveText([
      "All",
      "General",
      "Introductions",
      "Announcements",
    ]);
    await chips.getByRole("link", { name: "Introductions" }).click();
    await expect(member.page).toHaveURL(
      (url) => url.searchParams.get("category") === "introductions",
    );
    await expect(posts(member.page)).toHaveCount(1);
    await expect(posts(member.page).first()).toContainText("Hello from Mia");
    await expect(chips.getByRole("link", { name: "Introductions" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await member.page
      .getByRole("navigation", { name: "Sort posts" })
      .getByRole("link", { name: "Top" })
      .click();
    await expect(member.page).toHaveURL(
      (url) =>
        url.searchParams.get("category") === "introductions" &&
        url.searchParams.get("sort") === "top",
    );
    await expect(chips.getByRole("link", { name: "All" })).toHaveAttribute(
      "href",
      `/c/${slug}?sort=top`,
    );
    await expectAccessible(member.page, "feed filtered by category");
  });

  await test.step("Top and Active keep the pinned post first and order the rest", async () => {
    const order = async (sort: string) => {
      await member.page.goto(`/c/${slug}?sort=${sort}`);
      await settle(member.page);
      await expect(posts(member.page)).toHaveCount(3);
      return posts(member.page).allInnerTexts();
    };
    const top = await order("top");
    expect(top[0]).toContain("Welcome everyone");
    expect(top[1]).toContain("Kiln schedule");
    expect(top[2]).toContain("Hello from Mia");
    const active = await order("active");
    expect(active[0]).toContain("Welcome everyone");
    expect(active[1]).toContain("Kiln schedule");
    expect(active[2]).toContain("Hello from Mia");
    const newest = await order("new");
    expect(newest[0]).toContain("Welcome everyone");
    expect(newest[1]).toContain("Kiln schedule");
    expect(newest[2]).toContain("Hello from Mia");
  });
});

test("step 10 search: mobile icon, keyboard flow, grouped results, no results, and exclusions", async ({
  actor,
}) => {
  const owner = await actor("Olga", { desktop: true });
  const slug = await createCommunity(owner.page, `Glaze lab ${uniqueSuffix()}`, "public");
  const privateSlug = await createCommunity(owner.page, `Hidden ${uniqueSuffix()}`, "private");
  await writePost(owner.page, privateSlug, "Glaze hidden notes");
  await writePost(owner.page, slug, "Glaze recipes for the kiln");
  const hours = await writePost(owner.page, slug, "Studio hours");
  await writeComment(owner.page, hours, "The glaze room opens at nine");
  const courseSlug = await createCourse(owner.page, slug, "Glaze course");
  await addLesson(owner.page, slug, courseSlug, "Module 1", {
    title: "Glaze basics",
    body: "Mix it.",
  });
  await addLesson(owner.page, slug, courseSlug, "Module 1", {
    title: "Glaze secrets",
    body: "Draft only.",
    draft: true,
  });
  await publishCourse(owner.page, slug, courseSlug);

  const member = await actor("Mia", { mobile: true });
  await joinCommunity(member.page, slug);

  await test.step("the mobile header search icon opens a search dialog", async () => {
    await member.page.goto(`/c/${slug}`);
    await member.page.getByRole("button", { name: "Search this community" }).click();
    const dialog = member.page.getByRole("dialog", { name: "Search" });
    await expect(dialog.getByRole("searchbox", { name: "Search this community" })).toBeFocused();
    await expectNoHorizontalScroll(member.page);
    await expectAccessible(member.page, "search dialog (390 wide)");
  });

  await test.step("typing and Enter runs the search and groups the results", async () => {
    await member.page
      .getByRole("dialog", { name: "Search" })
      .getByRole("searchbox", { name: "Search this community" })
      .fill("glaze");
    await member.page.keyboard.press("Enter");
    await expect(member.page).toHaveURL((url) => url.searchParams.get("q") === "glaze");
    await expect(member.page.getByRole("heading", { name: /^Posts \(2\)/ })).toBeVisible();
    await expect(member.page.getByRole("heading", { name: /^Members \(0\)/ })).toBeVisible();
    await expect(member.page.getByRole("heading", { name: /^Classroom \(1\)/ })).toBeVisible();
    await expect(member.page.getByRole("link", { name: /Glaze basics/ })).toBeVisible();
    await expect(member.page.getByRole("link", { name: /Comment by Olga/ })).toBeVisible();
    await expect(member.page.getByText("Glaze secrets")).toHaveCount(0);
    await expect(member.page.getByText("Glaze hidden notes")).toHaveCount(0);
    await expectNoHorizontalScroll(member.page);
    await expectAccessible(member.page, "search results (390 wide)");
  });

  await test.step("no results copy", async () => {
    await member.page.goto(`/c/${slug}/search?q=zzqxv`);
    await expect(member.page.getByRole("status")).toContainText(
      "No results for ‘zzqxv’. Try fewer words.",
    );
    await expectAccessible(member.page, "search (no results)");
  });

  await test.step("the desktop header field works from the keyboard", async () => {
    await owner.page.goto(`/c/${slug}`);
    const field = owner.page
      .getByRole("banner")
      .getByRole("searchbox", { name: "Search this community" });
    await field.focus();
    await owner.page.keyboard.type("kiln");
    await owner.page.keyboard.press("Enter");
    await expect(owner.page).toHaveURL(
      (url) => url.pathname === `/c/${slug}/search` && url.searchParams.get("q") === "kiln",
    );
    await expect(
      owner.page.getByRole("link", { name: /Glaze recipes for the kiln/ }),
    ).toBeVisible();
    await expectAccessible(owner.page, "search results (desktop)");
  });

  await test.step("a private community stays closed to people outside it", async () => {
    await member.page.goto(`/c/${privateSlug}/search?q=glaze`);
    await expect(member.page.getByText("Glaze hidden notes")).toHaveCount(0);
    await expect(member.page.getByRole("heading", { name: /^Posts \(/ })).toHaveCount(0);
    const guest = await actor("Gia", { signedIn: false });
    await guest.page.goto(`/c/${privateSlug}/search?q=glaze`);
    await expect(guest.page.getByText("Glaze hidden notes")).toHaveCount(0);
    await expect(guest.page.getByRole("heading", { name: /^Posts \(/ })).toHaveCount(0);
  });
});
