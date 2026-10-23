import { createHash, randomBytes } from "node:crypto";

import type { APIRequestContext, Page } from "@playwright/test";

import { expectAccessible } from "../support/axe";
import { query } from "../support/db";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, expectNoHorizontalScroll } from "../pages/community";
import { settle } from "../pages/feed";

const callback = "http://127.0.0.1:47999/callback";

interface Discovery {
  readonly resource: string;
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly registrationEndpoint: string;
  readonly revocationEndpoint: string;
}

interface Tokens {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
  readonly scope: string;
}

async function discover(request: APIRequestContext): Promise<Discovery> {
  const resource = await request.get("/.well-known/oauth-protected-resource");
  expect(resource.status()).toBe(200);
  const prm = (await resource.json()) as { resource: string; authorization_servers: string[] };
  const issuer = prm.authorization_servers[0] ?? "";
  const metadata = await request.get(`${issuer}/.well-known/oauth-authorization-server`);
  expect(metadata.status()).toBe(200);
  const as = (await metadata.json()) as Record<string, unknown>;
  expect(as.issuer).toBe(issuer);
  expect(as.code_challenge_methods_supported).toEqual(["S256"]);
  return {
    resource: prm.resource,
    issuer,
    authorizationEndpoint: String(as.authorization_endpoint),
    tokenEndpoint: String(as.token_endpoint),
    registrationEndpoint: String(as.registration_endpoint),
    revocationEndpoint: String(as.revocation_endpoint),
  };
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function authorize(
  page: Page,
  discovery: Discovery,
  clientId: string,
  approve: (page: Page) => Promise<void>,
): Promise<{ code: string; verifier: string }> {
  const { verifier, challenge } = pkce();
  const state = randomBytes(8).toString("hex");
  const url = new URL(discovery.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: callback,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "community:read posts:read posts:write",
    resource: discovery.resource,
  }).toString();
  let landed = "";
  await page.route(`${callback}**`, async (route) => {
    landed = route.request().url();
    await route.fulfill({ status: 200, contentType: "text/html", body: "<title>Done</title>ok" });
  });
  await page.goto(url.toString());
  await settle(page);
  await approve(page);
  await expect.poll(() => landed).not.toBe("");
  const back = new URL(landed);
  expect(back.searchParams.get("state")).toBe(state);
  expect(back.searchParams.get("iss")).toBe(discovery.issuer);
  await page.unroute(`${callback}**`);
  return { code: back.searchParams.get("code") ?? "", verifier };
}

async function listPostsViaMcp(request: APIRequestContext, token: string) {
  return request.post("/mcp", {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_posts", arguments: {} },
    },
  });
}

async function tokenRequest(
  request: APIRequestContext,
  discovery: Discovery,
  form: Record<string, string>,
) {
  return request.post(discovery.tokenEndpoint, { form });
}

test("step 14 oauth: an MCP client connects through the consent screen", async ({
  actor,
  request,
}) => {
  const owner = await actor("Ola", { desktop: true });
  const slug = await createCommunity(owner.page, `OAuth ${uniqueSuffix()}`, "public");
  const discovery = await discover(request);
  expect(discovery.resource).toBe(`${discovery.issuer}/mcp`);

  const registered = await request.post(discovery.registrationEndpoint, {
    data: {
      client_name: "Desk Assistant",
      redirect_uris: [callback],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  });
  expect(registered.status()).toBe(201);
  const clientId = ((await registered.json()) as { client_id: string }).client_id;

  let first: Tokens | undefined;
  await test.step("the owner approves on the consent screen", async () => {
    const { code, verifier } = await authorize(owner.page, discovery, clientId, async (page) => {
      await expect(page.getByRole("heading", { name: "Connect Desk Assistant" })).toBeVisible();
      await expect(page.getByText("127.0.0.1:47999")).toBeVisible();
      await expect(page.getByText(/has not verified this app/)).toBeVisible();
      await expect(page.getByText("It can: read the community, read posts.")).toBeVisible();
      await expect(page.getByText(/^It also asked to: write posts\./)).toBeVisible();
      await page.getByText("Change permissions").click();
      await expect(page.getByRole("checkbox", { name: /^Read posts/ })).toBeChecked();
      await expect(page.getByRole("checkbox", { name: /^Write posts/ })).not.toBeChecked();
      await expectAccessible(page, "oauth consent");
      await page.setViewportSize({ width: 390, height: 844 });
      await expectNoHorizontalScroll(page);
      await expectAccessible(page, "oauth consent on a phone");
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByLabel("Agent name").fill("Desk agent");
      await page.getByRole("button", { name: /^Allow access to / }).click();
    });
    const response = await tokenRequest(request, discovery, {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: callback,
      resource: discovery.resource,
    });
    expect(response.status()).toBe(200);
    first = (await response.json()) as Tokens;
    expect(first.expires_in).toBe(3600);
    expect(first.scope).toBe("community:read posts:read");
    const replay = await tokenRequest(request, discovery, {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: callback,
    });
    expect(replay.status()).toBe(400);
  });

  await test.step("the access token was revoked by the code replay, so connect again", async () => {
    const api = await listPostsViaMcp(request, first?.access_token ?? "");
    expect(api.status()).toBe(401);
  });

  let tokens: Tokens | undefined;
  await test.step("a second connection reuses the agent and calls /mcp, never /api/v1", async () => {
    const { code, verifier } = await authorize(owner.page, discovery, clientId, async (page) => {
      await expect(page.getByRole("radio", { name: "Use one of your agents" })).toBeChecked();
      await expect(page.getByLabel("Your agent", { exact: true })).toHaveValue(/.+/);
      await expect(
        page.getByText(/Desk Assistant at 127\.0\.0\.1:47999 used this agent last time/),
      ).toBeVisible();
      await page.getByRole("button", { name: /^Allow access to / }).click();
    });
    const response = await tokenRequest(request, discovery, {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: callback,
      resource: discovery.resource,
    });
    expect(response.status()).toBe(200);
    tokens = (await response.json()) as Tokens;
    const api = await listPostsViaMcp(request, tokens.access_token);
    expect(api.status()).toBe(200);
    const direct = await request.get(`/api/v1/communities/${slug}/posts`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(direct.status()).toBe(401);
  });

  await test.step("refresh rotates, and reusing the old refresh token ends the connection", async () => {
    const rotated = await tokenRequest(request, discovery, {
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: tokens?.refresh_token ?? "",
    });
    expect(rotated.status()).toBe(200);
    const next = (await rotated.json()) as Tokens;
    const ok = await listPostsViaMcp(request, next.access_token);
    expect(ok.status()).toBe(200);
    const reuse = await tokenRequest(request, discovery, {
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: tokens?.refresh_token ?? "",
    });
    expect(reuse.status()).toBe(400);
    expect(((await reuse.json()) as { error: string }).error).toBe("invalid_grant");
    const after = await listPostsViaMcp(request, next.access_token);
    expect(after.status()).toBe(401);
  });

  await test.step("disconnecting from Settings stops the app on its next request", async () => {
    const { code, verifier } = await authorize(owner.page, discovery, clientId, async (page) => {
      await page.getByRole("radio", { name: "Create a new agent" }).check();
      await page.getByLabel("Agent name").fill("Settings agent");
      await page.getByRole("button", { name: /^Allow access to / }).click();
    });
    const response = await tokenRequest(request, discovery, {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: callback,
    });
    const live = (await response.json()) as Tokens;
    const api = await listPostsViaMcp(request, live.access_token);
    expect(api.status()).toBe(200);

    const page = owner.page;
    await page.goto(`/c/${slug}/manage/settings/agents`);
    await settle(page);
    await expect(page.getByRole("heading", { name: "Connect an AI assistant" })).toBeVisible();
    await expect(page.getByTestId("mcp-url")).toHaveText(/\/mcp$/);
    const item = page
      .getByRole("list", { name: "Apps connected to Settings agent" })
      .getByRole("listitem")
      .filter({ hasText: "Connected through Desk Assistant" });
    await expect(item).toBeVisible();
    await expect(page.getByRole("list", { name: "Tokens for Settings agent" })).toHaveCount(0);
    await expectAccessible(page, "agents with connected apps");
    await item.getByRole("button", { name: "Disconnect" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(item).toHaveCount(0);
    const after = await listPostsViaMcp(request, live.access_token);
    expect(after.status()).toBe(401);

    await page.goto("/account/connected-apps");
    await settle(page);
    await expect(page.getByRole("heading", { name: "Connected apps", level: 1 })).toBeVisible();
    await expectAccessible(page, "account connected apps");
    const actions = await query(
      `select a.action from audit_log a join communities c on c.id = a.community_id where c.slug = '${slug}' and a.action like 'oauth.%' order by a.created_at`,
    );
    const names = actions.map((row) => row[0]);
    expect(names).toEqual(
      expect.arrayContaining([
        "oauth.grant_created",
        "oauth.token_issued",
        "oauth.token_refreshed",
        "oauth.grant_revoked",
        "oauth.disconnected",
      ]),
    );
  });
});
