import { readFileSync } from "node:fs";

import { expectAccessible } from "../support/axe";
import { query } from "../support/db";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, expectNoHorizontalScroll } from "../pages/community";
import { posts, settle } from "../pages/feed";
import { confirmPlatformImport, uploadPlatformFiles, type UploadFile } from "../pages/migration";

const fixtures = new URL("../../../packages/migration/src/importers/fixtures/", import.meta.url);

function fixture(path: string, mimeType: string): UploadFile {
  return {
    name: path.split("/").pop() ?? path,
    mimeType,
    buffer: readFileSync(new URL(path, fixtures)),
  };
}

async function communityId(slug: string): Promise<string> {
  const [row] = await query(`select id from communities where slug = '${slug}'`);
  if (!row?.[0]) throw new Error(`no community ${slug}`);
  return row[0];
}

async function count(table: string, id: string): Promise<number> {
  const [row] = await query(`select count(*) from ${table} where community_id = '${id}'`);
  return Number(row?.[0] ?? 0);
}

test("step 11 importers: the Skool fixture moves into an empty community", async ({ actor }) => {
  const owner = await actor("Olga", { desktop: true });
  const slug = await createCommunity(owner.page, `From Skool ${uniqueSuffix()}`, "private");

  await uploadPlatformFiles(owner.page, slug, "Skool", [
    fixture("skool/members.csv", "text/csv"),
    fixture("skool/posts.json", "application/json"),
    fixture("skool/comments.json", "application/json"),
  ]);
  await expect(owner.page.getByText("Members CSV")).toBeVisible();
  await expectAccessible(owner.page, "migration (Skool preview)");
  await confirmPlatformImport(owner.page, "Skool");
  await expectAccessible(owner.page, "migration (Skool imported)");

  await owner.page.reload();
  await settle(owner.page);
  await expect(owner.page.getByRole("heading", { name: "Import history" })).toBeVisible();
  await expect(owner.page.getByText(/Emails not sent yet/)).toBeVisible();
  await expect(owner.page.getByRole("button", { name: "Send the emails" })).toBeVisible();
  const report = owner.page.getByRole("link", { name: /^Download report of the Skool import/ });
  const reportResponse = await owner.page
    .context()
    .request.get((await report.getAttribute("href")) ?? "");
  expect(reportResponse.status(), "import report").toBe(200);
  expect(await reportResponse.text()).toContain("source,Skool,,");

  await owner.page.goto(`/c/${slug}`);
  await settle(owner.page);
  await expect(posts(owner.page).filter({ hasText: "Welcome to the community" })).toHaveCount(1);
  await expect(
    posts(owner.page).filter({ hasText: "Ada Lovelace" }).first(),
    "history keeps the imported author's name",
  ).toBeVisible();
  await owner.page.goto(`/c/${slug}/members`);
  await settle(owner.page);
  await expect(owner.page.getByText(owner.person.name).first()).toBeVisible();
  await expect(
    owner.page.getByText("Ada Lovelace"),
    "invited people are not members yet",
  ).toHaveCount(0);

  const id = await communityId(slug);
  expect(await count("posts", id)).toBeGreaterThanOrEqual(3);
  expect(await count("comments", id)).toBeGreaterThanOrEqual(3);
  expect(await count("memberships", id)).toBe(4);
  const [admin] = await query(
    `select m.role, m.status from memberships m join users u on u.id = m.user_id where m.community_id = '${id}' and u.name = 'Ada Lovelace' and u.email like 'imported-%@import.invalid'`,
  );
  expect(admin, "Ada is kept apart until she accepts her invitation on Cloud").toEqual([
    "admin",
    "removed",
  ]);
});

test("step 11 importers: the Circle fixture brings spaces as categories", async ({ actor }) => {
  const owner = await actor("Olga", { desktop: true });
  const slug = await createCommunity(owner.page, `From Circle ${uniqueSuffix()}`, "private");

  await uploadPlatformFiles(owner.page, slug, "Circle", [
    fixture("circle/members.csv", "text/csv"),
    fixture("circle/spaces.csv", "text/csv"),
    fixture("circle/posts.csv", "text/csv"),
    fixture("circle/comments.csv", "text/csv"),
  ]);
  await confirmPlatformImport(owner.page, "Circle");

  await owner.page.goto(`/c/${slug}`);
  await settle(owner.page);
  await expect(posts(owner.page).filter({ hasText: "Read this first" })).toHaveCount(1);
  const id = await communityId(slug);
  const [spaces] = await query(
    `select count(*) from categories where community_id = '${id}' and name in ('Start here', 'Show and tell')`,
  );
  expect(spaces?.[0]).toBe("2");
  const [styles] = await query(
    `select count(*) from posts where community_id = '${id}' and (body_html ilike '%<style%' or body_html ilike '%<iframe%')`,
  );
  expect(styles?.[0], "styles and raw iframes are removed").toBe("0");
});

test("step 11 importers: scripts and event handlers in imported HTML are removed", async ({
  actor,
}) => {
  const owner = await actor("Olga", { desktop: true });
  const slug = await createCommunity(owner.page, `Hostile ${uniqueSuffix()}`, "private");
  const hostile = JSON.stringify([
    {
      id: "hostile-1",
      title: "Hostile post",
      html: '<p>Safe <strong>text</strong><script>window.pwned = 1</script><img src="x" onerror="window.pwned = 2"> <a href="javascript:alert(1)">bad link</a> <a href="https://example.test/ok">good link</a></p>',
      author: { name: "Ada Lovelace" },
      created_at: "2025-03-01T10:00:00Z",
    },
  ]);
  await uploadPlatformFiles(owner.page, slug, "Skool", [
    fixture("skool/members.csv", "text/csv"),
    { name: "posts.json", mimeType: "application/json", buffer: Buffer.from(hostile) },
  ]);
  await confirmPlatformImport(owner.page, "Skool");

  const id = await communityId(slug);
  const [row] = await query(`select body_html from posts where community_id = '${id}'`);
  const html = row?.[0] ?? "";
  expect(html).toContain("Safe");
  expect(html).toContain("https://example.test/ok");
  expect(html).not.toMatch(/<script|onerror|javascript:/i);

  await owner.page.goto(`/c/${slug}`);
  await settle(owner.page);
  const article = posts(owner.page).filter({ hasText: "Safe" }).first();
  await expect(article).toBeVisible();
  expect(await article.evaluate((node) => node.innerHTML)).not.toMatch(
    /<script|onerror|javascript:/i,
  );
  expect(await owner.page.evaluate(() => "pwned" in window)).toBe(false);
});

test("step 11 importers: the limits pages render for visitors", async ({ actor }) => {
  const guest = await actor("Gia", { signedIn: false, mobile: true });
  for (const [source, name] of [
    ["skool", "Skool"],
    ["circle", "Circle"],
  ] as const) {
    await guest.page.goto(`/importers/${source}`);
    await expect(
      guest.page.getByRole("heading", { name: `Importing from ${name}`, level: 1 }),
    ).toBeVisible();
    await expect(guest.page.getByText("What does not move")).toBeVisible();
    await expect(guest.page.getByRole("link", { name: "Start an import" })).toHaveAttribute(
      "href",
      "/communities/new",
    );
    await expectNoHorizontalScroll(guest.page);
    await expectAccessible(guest.page, `importer limits (${source}, 390 wide)`);
  }

  await guest.page.goto("/importers");
  await expect(
    guest.page.getByRole("heading", { name: "Move your community", level: 1 }),
  ).toBeVisible();
  await expect(guest.page.getByRole("link", { name: "From Circle" })).toHaveAttribute(
    "href",
    "/importers/circle",
  );
  await expect(guest.page.getByText("Members spreadsheet")).toBeVisible();
  await expectNoHorizontalScroll(guest.page);
  await expectAccessible(guest.page, "importers index (390 wide)");

  const unknown = await guest.page.goto("/importers/kajabi");
  expect(unknown?.status()).toBe(404);
});
