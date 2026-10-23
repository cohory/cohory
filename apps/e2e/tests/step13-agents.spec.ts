import { createClient } from "@cohory/sdk";

import { expectAccessible } from "../support/axe";
import { query } from "../support/db";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, expectNoHorizontalScroll } from "../pages/community";
import { posts, settle } from "../pages/feed";

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3310";

function doc(text: string) {
  return {
    type: "doc" as const,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

test("step 13 agents: a draft from an agent is published by a person, then the agent is revoked", async ({
  actor,
  request,
}) => {
  const owner = await actor("Petra", { desktop: true });
  const slug = await createCommunity(owner.page, `Agents ${uniqueSuffix()}`, "public");
  const draftText = `Monday plan ${uniqueSuffix()}`;
  let token = "";

  await test.step("the owner creates an agent that may write posts and issues a token", async () => {
    const page = owner.page;
    await page.goto(`/c/${slug}/manage/settings/agents`);
    await settle(page);
    await expectAccessible(page, "agents");
    await page.getByLabel("Name", { exact: true }).fill("Writer");
    await page.getByRole("checkbox", { name: /^Write posts/ }).check();
    await page.getByRole("button", { name: "Create agent" }).click();
    const reveal = page.getByRole("dialog", { name: /Writer is ready/ });
    await expect(reveal.getByRole("button", { name: "Copy token" })).toBeFocused();
    token = (await reveal.getByTestId("new-token").innerText()).trim();
    expect(token).toMatch(/^cohory_[A-Za-z0-9_-]{43}$/);
    await expect(reveal.getByText(/\/mcp$/)).toBeVisible();
    await expectAccessible(page, "agent token dialog");
    await reveal.getByRole("button", { name: "I stored it" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Writer" }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("new-token")).toHaveCount(0);
    await expect(page.getByText(token)).toHaveCount(0);
    await expectAccessible(page, "agents with a token");
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, "agents on a phone");
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await test.step("the agent's post waits as a draft and is not in the feed", async () => {
    const response = await request.post(`/api/v1/communities/${slug}/posts`, {
      headers: { authorization: `Bearer ${token}` },
      data: { title: draftText, body: doc("Written by the agent") },
    });
    expect(response.status()).toBe(201);
    expect(await response.json()).toMatchObject({ status: "draft" });
    await owner.page.goto(`/c/${slug}`);
    await expect(posts(owner.page).filter({ hasText: draftText })).toHaveCount(0);
  });

  await test.step("a person publishes the draft and the feed shows the Agent badge", async () => {
    const page = owner.page;
    await page.goto(`/c/${slug}/manage/settings/agents`);
    await settle(page);
    const draft = page
      .getByRole("region", { name: "Drafts waiting for you" })
      .getByRole("listitem")
      .filter({ hasText: draftText });
    await expect(draft.locator('[data-slot="agent-badge"]')).toBeVisible();
    await draft.getByRole("button", { name: "Publish" }).click();
    await expect(draft).toHaveCount(0);
    await page.goto(`/c/${slug}`);
    const article = posts(page).filter({ hasText: draftText }).first();
    await expect(article).toBeVisible();
    await expect(article.locator('[data-slot="agent-badge"]')).toBeVisible();
    await expect(article.locator('[data-slot="agent-badge"]')).toContainText("Writer");
  });

  await test.step("revoking the agent refuses its next request with 401", async () => {
    const before = await request.get(`/api/v1/communities/${slug}/posts`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.status()).toBe(200);
    const page = owner.page;
    await page.goto(`/c/${slug}/manage/settings/agents`);
    await settle(page);
    await page.getByRole("button", { name: "Revoke agent" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Revoke agent" }).click();
    await expect(page.getByText("Revoked").first()).toBeVisible();
    const after = await request.get(`/api/v1/communities/${slug}/posts`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.status()).toBe(401);
    expect(await after.json()).toMatchObject({ error: { code: "invalid_token" } });
    const rows = await query(
      `select a.action from audit_log a join communities c on c.id = a.community_id where c.slug = '${slug}' and a.actor_type = 'agent'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});

test("step 13 SDK: a personal token from Account works through the typed client", async ({
  actor,
}) => {
  const owner = await actor("Quinn", { desktop: true });
  const slug = await createCommunity(owner.page, `Sdk ${uniqueSuffix()}`, "public");
  const other = await actor("Rhea", { desktop: true });
  const otherSlug = await createCommunity(other.page, `Elsewhere ${uniqueSuffix()}`, "public");
  const page = owner.page;

  await page.goto("/account/api-tokens");
  await settle(page);
  await expectAccessible(page, "api tokens");
  await page.getByLabel("Name", { exact: true }).fill("Script");
  await page.getByRole("checkbox", { name: /^Write posts/ }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const token = (await page.getByTestId("new-token").innerText()).trim();
  expect(token).toMatch(/^cohory_/);
  // The button turns from "Creating token" back to idle when the refresh after creating lands; scan
  // after that so a color transition is never caught half way.
  await expect(page.locator('button[type="submit"]', { hasText: "Create token" })).toBeAttached();
  await expectAccessible(page, "api tokens with a new token");
  await page.getByRole("button", { name: "I stored it" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);
  await expectAccessible(page, "api tokens on a phone");

  const cohory = createClient({ baseUrl, token });
  const created = await cohory.POST("/api/v1/communities/{slug}/posts", {
    params: { path: { slug } },
    body: { title: "From the SDK", body: doc("Sent with @cohory/sdk") },
  });
  expect(created.error).toBeUndefined();
  expect(created.response.status).toBe(201);
  const feed = await cohory.GET("/api/v1/communities/{slug}/posts", {
    params: { path: { slug } },
  });
  expect(feed.response.headers.get("ratelimit-limit")).not.toBeNull();
  expect(feed.data?.data.map((post) => post.title)).toContain("From the SDK");
  const elsewhere = await cohory.GET("/api/v1/communities/{slug}/posts", {
    params: { path: { slug: otherSlug } },
  });
  expect(elsewhere.response.status).toBe(403);
  expect(elsewhere.error?.error.code).toBe("wrong_community");
  const altered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  const anonymous = await createClient({ baseUrl, token: altered }).GET(
    "/api/v1/communities/{slug}/posts",
    { params: { path: { slug } } },
  );
  expect(anonymous.response.status).toBe(401);
});
