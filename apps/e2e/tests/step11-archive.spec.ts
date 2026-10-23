import { expectAccessible } from "../support/axe";
import { query, userIdOf } from "../support/db";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { storedZip } from "../support/zip";
import { createCommunity, joinCommunity } from "../pages/community";
import { posts, settle, setLiked, writeComment, writePost } from "../pages/feed";
import { createInviteLink } from "../pages/manage";
import {
  confirmArchiveImport,
  exportArchive,
  migrationPath,
  uploadArchive,
} from "../pages/migration";

async function communityId(slug: string): Promise<string> {
  const [row] = await query(`select id from communities where slug = '${slug}'`);
  if (!row?.[0]) throw new Error(`no community ${slug}`);
  return row[0];
}

async function count(table: string, id: string, where = "true"): Promise<string> {
  const [row] = await query(
    `select count(*) from ${table} where community_id = '${id}' and ${where}`,
  );
  return row?.[0] ?? "0";
}

test("step 11 archive: a community exports to a zip and imports into an empty one", async ({
  actor,
  baseURL,
}) => {
  test.slow();
  const owner = await actor("Olga", { desktop: true });
  const member = await actor("Ben");
  const sourceSlug = await createCommunity(owner.page, `Source ${uniqueSuffix()}`, "public");
  const postText = `Moving day ${uniqueSuffix()}`;

  await test.step("the source community gets content", async () => {
    const path = await writePost(owner.page, sourceSlug, postText, { image: true });
    await joinCommunity(member.page, sourceSlug);
    await writeComment(member.page, path, "Taking this with us");
    await setLiked(member.page, path, true);
  });
  const invite = await createInviteLink(owner.page, sourceSlug);
  const token = new URL(invite).pathname.split("/").pop() ?? "";
  const sourceId = await communityId(sourceSlug);
  const before = {
    posts: await count("posts", sourceId),
    comments: await count("comments", sourceId),
    reactions: await count("reactions", sourceId),
    members: await count("memberships", sourceId, "status = 'active'"),
    images: await count("post_images", sourceId),
  };
  expect(before).toEqual({ posts: "1", comments: "1", reactions: "1", members: "2", images: "1" });

  const archive = await test.step("the owner exports and downloads the archive", async () => {
    const bytes = await exportArchive(owner.page, sourceSlug);
    await expectAccessible(owner.page, "migration (export done)");
    expect(bytes.byteLength).toBeGreaterThan(1000);
    return bytes;
  });

  const targetSlug = await createCommunity(owner.page, `Target ${uniqueSuffix()}`, "private");

  await test.step("an archive with a path traversal upload key is refused", async () => {
    const hostile = storedZip({
      "manifest.json": JSON.stringify({ format: "cohory-archive", schemaVersion: "1.0.0" }),
      "uploads/../etc/passwd": "root:x:0:0",
    });
    const response = await owner.context.request.post(
      `/api/v1/communities/${targetSlug}/manage/migration/imports`,
      {
        multipart: { file: { name: "hostile.zip", mimeType: "application/zip", buffer: hostile } },
      },
    );
    expect(response.status()).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_archive" } });
  });

  await test.step("the archive imports into the empty community", async () => {
    await uploadArchive(owner.page, targetSlug, {
      name: "source.zip",
      mimeType: "application/zip",
      buffer: archive,
    });
    await expect(owner.page.getByRole("button", { name: "Import everything" })).toBeVisible({
      timeout: 60_000,
    });
    await expectAccessible(owner.page, "migration (import preview)");
    await confirmArchiveImport(owner.page);
    await expect(owner.page.getByText("1 linked by email, 1 person invited.")).toBeVisible();
    await expectAccessible(owner.page, "migration (import done)");
  });

  await test.step("the header member count is fresh without a reload", async () => {
    await owner.page.getByRole("link", { name: "Settings" }).first().click();
    await expect(owner.page).toHaveURL(
      (url) => url.pathname === `/c/${targetSlug}/manage/settings`,
    );
    await expect(owner.page.getByText("1 member").first()).toBeVisible();
  });

  const targetId = await communityId(targetSlug);
  await test.step("content, people, likes, and images arrived", async () => {
    expect({
      posts: await count("posts", targetId),
      comments: await count("comments", targetId),
      reactions: await count("reactions", targetId),
      members: await count("memberships", targetId, "status = 'active'"),
      images: await count("post_images", targetId),
    }).toEqual({ ...before, members: "1" });
    const real = await query(
      `select role from memberships where community_id = '${targetId}' and user_id = '${await userIdOf(member.person.email)}'`,
    );
    expect(real, "the member's own account is not added on Cloud").toEqual([]);
    const [placeholder] = await query(
      `select m.role, m.status from memberships m join users u on u.id = m.user_id where m.community_id = '${targetId}' and u.email like 'imported-%@import.invalid'`,
    );
    expect(placeholder, "a placeholder keeps history but is not a member").toEqual([
      "member",
      "removed",
    ]);
    await owner.page.goto(`/c/${targetSlug}`);
    await settle(owner.page);
    const article = posts(owner.page).filter({ hasText: postText }).first();
    await expect(article).toBeVisible();
    await expect(article.getByRole("link", { name: "1 comment" })).toBeVisible();
    await expect(article.getByRole("button", { name: "Like, 1 like" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const image = article.locator("img").first();
    await expect(image).toBeVisible();
    expect(await image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(
      0,
    );
  });

  await test.step("the invite link was imported with a new token and works", async () => {
    const [renamed] = await query(
      `select token from invite_links where community_id = '${targetId}' order by created_at asc limit 1`,
    );
    expect(renamed?.[0], "imported invite token").toBeTruthy();
    expect(renamed?.[0]).not.toBe(token);
    const late = await actor("Fay");
    await late.page.goto(`${baseURL}/join/${renamed?.[0] ?? ""}`);
    await settle(late.page);
    await late.page.getByRole("button", { name: "Join community" }).click();
    await expect(late.page).toHaveURL((url) => url.pathname === `/c/${targetSlug}`, {
      timeout: 30_000,
    });
  });

  await test.step("the migration page refuses a second import", async () => {
    await owner.page.goto(migrationPath(targetSlug));
    await expect(
      owner.page.getByText("An import already ran in this community. See Import history.").first(),
    ).toBeVisible();
    await expect(owner.page.getByRole("heading", { name: "Import history" })).toBeVisible();
  });
});
