import { ForbiddenError, type UserActor } from "@cohory/authz";
import {
  addMembership,
  communitySlugSchema,
  createCommunity,
  createDb,
  createPool,
  newId,
  parseAdminDatabaseEnv,
  setRlsValue,
  withCommunity,
  type CommunityId,
} from "@cohory/db";
import { agentIdentities, auditLog, oauthGrants, users } from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { InvalidTokenError } from "../errors";
import { createAgentsService } from "../service";
import { ConsentError, OAuthError } from "./errors";
import { oauthIssuer } from "./metadata";
import { s256Challenge } from "./secrets";
import { createOAuthService } from "./service";

const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
const db = createDb(pool);
let clock = new Date("2026-10-19T10:00:00.000Z");
const issuer = oauthIssuer("https://learn.example.com");
const oauth = createOAuthService({ db, issuer, now: () => clock });
const agents = createAgentsService({ db, now: () => clock });

const verifier = "a".repeat(20) + "-verifier-" + "b".repeat(20);
const challenge = s256Challenge(verifier);
const redirectUri = "http://127.0.0.1:33418/callback";

let communityA: CommunityId;
let communityB: CommunityId;
let ownerId: string;
let adminId: string;
let memberId: string;
let moderatorId: string;
let clientId: string;

function user(userId: string): UserActor {
  return { kind: "user", userId, platformAdmin: false };
}

async function insertUser(name: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ name, email: `${name.toLowerCase()}-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!row) throw new Error("no user");
  return row.id;
}

async function auditActions(communityId: string, target: string): Promise<string[]> {
  const rows = await db.transaction(async (tx) => {
    await setRlsValue(tx, "community_id", communityId);
    return tx
      .select({ action: auditLog.action, actorType: auditLog.actorType, actorId: auditLog.actorId })
      .from(auditLog)
      .where(and(eq(auditLog.communityId, communityId), eq(auditLog.target, target)))
      .orderBy(auditLog.createdAt, auditLog.id);
  });
  return rows.map((row) => row.action);
}

function authorizeParams(overrides: Record<string, string | undefined> = {}) {
  return {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state: "xyz-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: "https://learn.example.com/mcp",
    scope: "posts:read posts:write community:read",
    ...overrides,
  };
}

async function approve(
  actorId = ownerId,
  options: { communityId?: string; scopes?: string[]; agentName?: string } = {},
): Promise<{ code: string; state: string | null; iss: string | null }> {
  const result = await oauth.approve(user(actorId), {
    request: authorizeParams(),
    communityId: options.communityId ?? communityA,
    agent: { kind: "new", name: options.agentName ?? "Claude" },
    scopes: options.scopes ?? ["community:read", "posts:read"],
  });
  if (result.kind !== "redirect") throw new Error(result.message);
  const url = new URL(result.url);
  expect(`${url.origin}${url.pathname}`).toBe(redirectUri);
  return {
    code: url.searchParams.get("code") ?? "",
    state: url.searchParams.get("state"),
    iss: url.searchParams.get("iss"),
  };
}

async function exchange(code: string, overrides: Record<string, string> = {}) {
  return oauth.token({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    resource: "https://learn.example.com/mcp",
    ...overrides,
  });
}

async function oauthErrorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof OAuthError) return error.code;
    throw error;
  }
  return "no error";
}

async function tokenReason(token: string): Promise<string> {
  try {
    await agents.authenticate(token);
    return "ok";
  } catch (error: unknown) {
    if (error instanceof InvalidTokenError) return error.reason;
    throw error;
  }
}

beforeAll(async () => {
  const suffix = newId().slice(-12);
  communityA = (
    await createCommunity(db, {
      slug: communitySlugSchema.parse(`oauth-a-${suffix}`),
      name: "OAuth A",
    })
  ).id;
  communityB = (
    await createCommunity(db, {
      slug: communitySlugSchema.parse(`oauth-b-${suffix}`),
      name: "OAuth B",
    })
  ).id;
  ownerId = await insertUser("Owner");
  adminId = await insertUser("Admin");
  memberId = await insertUser("Member");
  moderatorId = await insertUser("Moderator");
  const a = withCommunity(db, communityA);
  await addMembership(a, { userId: ownerId, role: "owner", status: "active" });
  await addMembership(a, { userId: adminId, role: "admin", status: "active" });
  await addMembership(a, { userId: memberId, role: "member", status: "active" });
  await addMembership(a, { userId: moderatorId, role: "moderator", status: "active" });
  const b = withCommunity(db, communityB);
  await addMembership(b, { userId: memberId, role: "owner", status: "active" });
  await addMembership(b, { userId: ownerId, role: "member", status: "active" });
  const registered = await oauth.register({
    client_name: "Claude Desktop",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
  clientId = registered.client_id;
});

afterAll(async () => {
  await pool.end();
});

describe("dynamic client registration", () => {
  it("registers a public client and echoes its metadata", async () => {
    const registered = await oauth.register({
      client_name: "Inspector",
      redirect_uris: ["http://localhost:6274/oauth/callback", "https://app.example.com/cb"],
    });
    expect(registered).toMatchObject({
      client_name: "Inspector",
      redirect_uris: ["http://localhost:6274/oauth/callback", "https://app.example.com/cb"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
    expect(registered.client_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses insecure redirect URIs, unsupported grant types, and missing redirect URIs", async () => {
    expect(
      await oauthErrorOf(oauth.register({ redirect_uris: ["http://app.example.com/cb"] })),
    ).toBe("invalid_redirect_uri");
    expect(
      await oauthErrorOf(
        oauth.register({ redirect_uris: [redirectUri], grant_types: ["client_credentials"] }),
      ),
    ).toBe("invalid_client_metadata");
    expect(
      await oauthErrorOf(
        oauth.register({ redirect_uris: [redirectUri], response_types: ["token"] }),
      ),
    ).toBe("invalid_client_metadata");
    expect(await oauthErrorOf(oauth.register({ client_name: "No redirects" }))).toBe(
      "invalid_redirect_uri",
    );
  });
});

describe("authorization request checks", () => {
  it("shows an error instead of redirecting for an unknown client or a redirect mismatch", async () => {
    expect(
      (await oauth.checkAuthorizationRequest(authorizeParams({ client_id: newId() }))).kind,
    ).toBe("invalid");
    expect(
      (
        await oauth.checkAuthorizationRequest(
          authorizeParams({ redirect_uri: "http://127.0.0.1:33418/other" }),
        )
      ).kind,
    ).toBe("invalid");
  });

  it.each([
    [{ code_challenge_method: "plain" }, "invalid_request"],
    [{ code_challenge_method: undefined }, "invalid_request"],
    [{ code_challenge: undefined }, "invalid_request"],
    [{ response_type: "token" }, "unsupported_response_type"],
    [{ resource: "https://other.example.com/mcp" }, "invalid_target"],
  ])("redirects back with an error for %o", async (overrides, error) => {
    const check = await oauth.checkAuthorizationRequest(authorizeParams(overrides));
    expect(check.kind).toBe("redirect");
    if (check.kind !== "redirect") return;
    const url = new URL(check.url);
    expect(url.searchParams.get("error")).toBe(error);
    expect(url.searchParams.get("state")).toBe("xyz-state");
    expect(url.searchParams.get("iss")).toBe("https://learn.example.com");
  });

  it("preselects only requested read scopes and shows the redirect host", async () => {
    const check = await oauth.checkAuthorizationRequest(authorizeParams());
    expect(check.kind).toBe("ok");
    if (check.kind !== "ok") return;
    expect(check.request.preselectedScopes).toEqual(["community:read", "posts:read"]);
    expect(check.request.redirectHost).toBe("127.0.0.1:33418");
    expect(check.request.loopbackRedirect).toBe(true);
    expect(check.request.client.name).toBe("Claude Desktop");
  });
});

describe("consent", () => {
  it("offers only communities where the person may create agents", async () => {
    const forOwner = await oauth.consentOptions(user(ownerId));
    expect(forOwner.map((c) => c.id)).toEqual([communityA]);
    const forMember = await oauth.consentOptions(user(memberId));
    expect(forMember.map((c) => c.id)).toEqual([communityB]);
  });

  it("refuses approval for a community where the person may not create agents", async () => {
    await expect(approve(memberId, { communityId: communityA })).rejects.toBeInstanceOf(
      ConsentError,
    );
  });

  it("tells the consent screen which permissions each community allows the person to give", async () => {
    const [forOwner] = await oauth.consentOptions(user(ownerId));
    expect(forOwner?.available).toContain("payments:read");
    expect(forOwner?.available).toContain("proposals:write");
    expect(forOwner?.available).not.toContain("notifications:read");
  });

  it("preselects the agent an earlier connection of the same app used, and only the person's own", async () => {
    const app = await oauth.register({
      client_name: "Reconnect App",
      redirect_uris: [redirectUri],
    });
    const request = { ...authorizeParams(), client_id: app.client_id };
    const before = await oauth.consentOptions(user(ownerId), {
      clientId: app.client_id,
      redirectHost: "127.0.0.1:33418",
    });
    expect(before.find((c) => c.id === communityA)?.preferredAgentId).toBeNull();
    await oauth.approve(user(ownerId), {
      request,
      communityId: communityA,
      agent: { kind: "new", name: "Reconnect agent" },
      scopes: ["community:read"],
    });
    const after = await oauth.consentOptions(user(ownerId), {
      clientId: app.client_id,
      redirectHost: "127.0.0.1:33418",
    });
    const preferred = after.find((c) => c.id === communityA)?.preferredAgentId;
    const agent = after
      .find((c) => c.id === communityA)
      ?.agents.find((item) => item.id === preferred);
    expect(agent?.name).toBe("Reconnect agent");

    const again = await oauth.register({
      client_name: "Reconnect App",
      redirect_uris: [redirectUri],
    });
    const reRegistered = await oauth.consentOptions(user(ownerId), {
      clientId: again.client_id,
      redirectHost: "127.0.0.1:33418",
    });
    expect(reRegistered.find((c) => c.id === communityA)?.preferredAgentId).toBe(preferred);

    const forAdmin = await oauth.consentOptions(user(adminId), {
      clientId: app.client_id,
      redirectHost: "127.0.0.1:33418",
    });
    expect(forAdmin.find((c) => c.id === communityA)?.preferredAgentId).toBeNull();
  });

  it("does not preselect an agent for another client that only copies the app's name", async () => {
    const app = await oauth.register({ client_name: "Spoofed App", redirect_uris: [redirectUri] });
    await oauth.approve(user(ownerId), {
      request: { ...authorizeParams(), client_id: app.client_id },
      communityId: communityA,
      agent: { kind: "new", name: "Spoofed agent" },
      scopes: ["community:read"],
    });
    const attacker = await oauth.register({
      client_name: "Spoofed App",
      redirect_uris: ["https://attacker.example/callback"],
    });

    const options = await oauth.consentOptions(user(ownerId), {
      clientId: attacker.client_id,
      redirectHost: "attacker.example",
    });

    expect(options.find((c) => c.id === communityA)?.preferredAgentId).toBeNull();
  });

  it("stores only permissions the person's role can give when creating an agent", async () => {
    await oauth.approve(user(ownerId), {
      request: authorizeParams(),
      communityId: communityA,
      agent: { kind: "new", name: "Narrowed agent" },
      scopes: ["community:read", "notifications:read"],
    });
    const options = await oauth.consentOptions(user(ownerId));
    const agent = options
      .find((c) => c.id === communityA)
      ?.agents.find((item) => item.name === "Narrowed agent");

    expect(agent?.scopes).toEqual(["community:read"]);
  });

  it("returns access_denied with the state when the person cancels", async () => {
    const result = await oauth.deny(user(ownerId), authorizeParams());
    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    const url = new URL(result.url);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("xyz-state");
  });
});

describe("authorization code exchange", () => {
  it("issues a one hour agent api token and a refresh token bound to the new agent", async () => {
    const { code, state, iss } = await approve();
    expect(state).toBe("xyz-state");
    expect(iss).toBe("https://learn.example.com");

    const tokens = await exchange(code);
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.scope).toBe("community:read posts:read");
    expect(tokens.access_token).toMatch(/^cohory_/);
    expect(tokens.refresh_token).toMatch(/^cohoryrt_/);

    const authenticated = await agents.authenticate(tokens.access_token);
    expect(authenticated.userId).toBe(ownerId);
    expect(authenticated.credential.type).toBe("agent");
    expect(authenticated.credential.communityId).toBe(communityA);
    expect(authenticated.credential.scopes).toEqual(["community:read", "posts:read"]);
    const [agent] = await db.transaction(async (tx) => {
      await setRlsValue(tx, "community_id", communityA);
      return tx
        .select()
        .from(agentIdentities)
        .where(eq(agentIdentities.id, authenticated.credential.agentId ?? ""));
    });
    expect(agent?.ownerId).toBe(ownerId);
    expect(agent?.name).toBe("Claude");

    clock = new Date(clock.getTime() + 3601 * 1000);
    expect(await tokenReason(tokens.access_token)).toBe("expired");
  });

  it("accepts a code only once and ends the grant when it is replayed", async () => {
    const { code } = await approve();
    const tokens = await exchange(code);
    expect(await oauthErrorOf(exchange(code))).toBe("invalid_grant");
    expect(await tokenReason(tokens.access_token)).toBe("revoked");
    expect(
      await oauthErrorOf(
        oauth.token({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: tokens.refresh_token,
        }),
      ),
    ).toBe("invalid_grant");
  });

  it("refuses an expired code", async () => {
    const { code } = await approve();
    clock = new Date(clock.getTime() + 61 * 1000);
    expect(await oauthErrorOf(exchange(code))).toBe("invalid_grant");
  });

  it("refuses a wrong code verifier, a missing verifier, a redirect mismatch, and another resource", async () => {
    expect(
      await oauthErrorOf(exchange((await approve()).code, { code_verifier: "c".repeat(43) })),
    ).toBe("invalid_grant");
    expect(
      await oauthErrorOf(
        oauth.token({
          grant_type: "authorization_code",
          client_id: clientId,
          code: (await approve()).code,
          redirect_uri: redirectUri,
        }),
      ),
    ).toBe("invalid_request");
    expect(
      await oauthErrorOf(
        exchange((await approve()).code, { redirect_uri: "http://127.0.0.1:33418/other" }),
      ),
    ).toBe("invalid_grant");
    expect(
      await oauthErrorOf(
        exchange((await approve()).code, { resource: "https://other.example.com/mcp" }),
      ),
    ).toBe("invalid_target");
  });

  it("refuses a code presented by another client", async () => {
    const other = await oauth.register({ client_name: "Other", redirect_uris: [redirectUri] });
    const { code } = await approve();
    expect(await oauthErrorOf(exchange(code, { client_id: other.client_id }))).toBe(
      "invalid_grant",
    );
    expect(await oauthErrorOf(exchange(code, { client_id: newId() }))).toBe("invalid_client");
  });

  it("rejects unsupported grant types", async () => {
    expect(
      await oauthErrorOf(oauth.token({ grant_type: "client_credentials", client_id: clientId })),
    ).toBe("unsupported_grant_type");
  });
});

describe("refresh tokens", () => {
  it("rotates on use and revokes the whole family when a rotated token is reused", async () => {
    const first = await exchange((await approve()).code);
    const second = await oauth.token({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: first.refresh_token,
      resource: "https://learn.example.com/mcp",
    });
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(await tokenReason(second.access_token)).toBe("ok");

    expect(
      await oauthErrorOf(
        oauth.token({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: first.refresh_token,
        }),
      ),
    ).toBe("invalid_grant");
    expect(await tokenReason(second.access_token)).toBe("revoked");
    expect(await tokenReason(first.access_token)).toBe("revoked");
    expect(
      await oauthErrorOf(
        oauth.token({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: second.refresh_token,
        }),
      ),
    ).toBe("invalid_grant");

    const authenticated = await db.transaction(async (tx) => {
      await setRlsValue(tx, "community_id", communityA);
      return tx
        .select()
        .from(oauthGrants)
        .where(
          and(eq(oauthGrants.communityId, communityA), eq(oauthGrants.endReason, "refresh_reuse")),
        );
    });
    expect(authenticated.length).toBeGreaterThan(0);
    const grantId = authenticated[0]?.id ?? "";
    expect((await auditActions(communityA, grantId)).sort()).toEqual([
      "oauth.grant_created",
      "oauth.grant_revoked",
      "oauth.token_issued",
      "oauth.token_refreshed",
    ]);
  });

  it("may narrow but not widen scopes on refresh", async () => {
    const first = await exchange((await approve()).code);
    expect(
      await oauthErrorOf(
        oauth.token({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: first.refresh_token,
          scope: "posts:write",
        }),
      ),
    ).toBe("invalid_scope");
  });

  it("expires after 30 days", async () => {
    const first = await exchange((await approve()).code);
    clock = new Date(clock.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect(
      await oauthErrorOf(
        oauth.token({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: first.refresh_token,
        }),
      ),
    ).toBe("invalid_grant");
  });
});

describe("revocation and disconnect", () => {
  it("revoking a refresh token ends the grant on the next request", async () => {
    const tokens = await exchange((await approve()).code);
    await oauth.revoke({ token: tokens.refresh_token, client_id: clientId });
    expect(await tokenReason(tokens.access_token)).toBe("revoked");
  });

  it("revoking an access token stops only that token", async () => {
    const tokens = await exchange((await approve()).code);
    await oauth.revoke({ token: tokens.access_token, client_id: clientId });
    expect(await tokenReason(tokens.access_token)).toBe("revoked");
    const next = await oauth.token({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: tokens.refresh_token,
    });
    expect(await tokenReason(next.access_token)).toBe("ok");
  });

  it("ignores unknown tokens and refuses unknown clients", async () => {
    await expect(oauth.revoke({ token: "nonsense", client_id: clientId })).resolves.toBeUndefined();
    expect(await oauthErrorOf(oauth.revoke({ token: "x", client_id: newId() }))).toBe(
      "invalid_client",
    );
  });

  it("lists connected apps in Account and Manage and disconnects them immediately", async () => {
    const tokens = await exchange((await approve(adminId, { agentName: "Admin bot" })).code);
    await agents.authenticate(tokens.access_token);

    const mine = await oauth.listMyConnectedApps(user(adminId));
    const app = mine.find((item) => item.agent.name === "Admin bot");
    expect(app).toMatchObject({
      clientName: "Claude Desktop",
      canDisconnect: true,
      redirectHost: "127.0.0.1:33418",
    });
    expect(app?.lastUsedAt).not.toBeNull();
    expect(app?.community.id).toBe(communityA);

    const managed = await oauth.listConnectedApps(user(ownerId), communityA);
    expect(managed.some((item) => item.grantId === app?.grantId)).toBe(true);
    await expect(oauth.listConnectedApps(user(memberId), communityA)).rejects.toThrow();

    await oauth.disconnect(user(ownerId), app?.grantId ?? "", communityA);
    expect(await tokenReason(tokens.access_token)).toBe("revoked");
    expect(
      (await oauth.listMyConnectedApps(user(adminId))).some((i) => i.grantId === app?.grantId),
    ).toBe(false);
    expect(await auditActions(communityA, app?.grantId ?? "")).toContain("oauth.disconnected");
  });

  it("does not let a member disconnect someone else's app", async () => {
    const { code } = await approve(ownerId);
    await exchange(code);
    const [grant] = await oauth.listMyConnectedApps(user(ownerId));
    await expect(oauth.disconnect(user(memberId), grant?.grantId ?? "")).rejects.toThrow();
    await expect(
      oauth.disconnect(user(memberId), grant?.grantId ?? "", communityA),
    ).rejects.toThrow();
  });
  it("lets only owners and admins disconnect another person's app on a community wide agent", async () => {
    const shared = await agents.createAgent(user(ownerId), communityA, {
      name: "Shared helper",
      scopes: ["community:read", "posts:read"],
      communityWide: true,
    });
    const result = await oauth.approve(user(ownerId), {
      request: authorizeParams(),
      communityId: communityA,
      agent: { kind: "existing", agentId: shared.id },
      scopes: ["community:read", "posts:read"],
    });
    if (result.kind !== "redirect") throw new Error("expected redirect");
    const tokens = await exchange(new URL(result.url).searchParams.get("code") ?? "");
    const grant = (await oauth.listMyConnectedApps(user(ownerId))).find(
      (item) => item.agent.id === shared.id,
    );
    const grantId = grant?.grantId ?? "";

    for (const actorId of [memberId, moderatorId]) {
      await expect(oauth.disconnect(user(actorId), grantId, communityA)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    expect(await tokenReason(tokens.access_token)).toBe("ok");

    const managed = await oauth.listConnectedApps(user(adminId), communityA);
    expect(managed.find((item) => item.grantId === grantId)?.canDisconnect).toBe(true);
    await oauth.disconnect(user(adminId), grantId, communityA);
    expect(await tokenReason(tokens.access_token)).toBe("revoked");
  });
});

describe("password changes", () => {
  it("revokes every token and ends every connected app of the person in every community", async () => {
    const person = await insertUser("Changer");
    await addMembership(withCommunity(db, communityA), {
      userId: person,
      role: "admin",
      status: "active",
    });
    await addMembership(withCommunity(db, communityB), {
      userId: person,
      role: "member",
      status: "active",
    });
    const app = await exchange((await approve(person, { agentName: "Changer app" })).code);
    const personal = await agents.createPersonalToken(user(person), {
      communityId: communityB,
      name: "Script",
      scopes: ["posts:read"],
    });
    const agent = await agents.createAgent(user(person), communityA, {
      name: "Changer agent",
      scopes: ["posts:read"],
    });
    const agentToken = await agents.issueAgentToken(user(person), communityA, agent.id, {
      name: "Key",
    });
    const bystander = await agents.createPersonalToken(user(memberId), {
      communityId: communityA,
      name: "Someone else",
      scopes: ["posts:read"],
    });

    await agents.revokeAllCredentials(person);

    expect(await tokenReason(personal.token)).toBe("revoked");
    expect(await tokenReason(agentToken.token)).toBe("revoked");
    expect(await tokenReason(app.access_token)).toBe("revoked");
    expect(
      await oauthErrorOf(
        oauth.token({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: app.refresh_token,
        }),
      ),
    ).toBe("invalid_grant");
    expect(await oauth.listMyConnectedApps(user(person))).toEqual([]);
    expect(await tokenReason(bystander.token)).toBe("ok");
  });
});

describe("tenancy and reused agents", () => {
  it("binds tokens to the chosen community only", async () => {
    const tokens = await exchange((await approve(memberId, { communityId: communityB })).code);
    const authenticated = await agents.authenticate(tokens.access_token);
    expect(authenticated.credential.communityId).toBe(communityB);
    expect(authenticated.credential.communityId).not.toBe(communityA);
  });

  it("limits a reused agent to the scopes it already has", async () => {
    const options = await oauth.consentOptions(user(ownerId));
    const existing = options[0]?.agents.find((agent) => agent.name === "Claude");
    expect(existing).toBeDefined();
    const result = await oauth.approve(user(ownerId), {
      request: authorizeParams(),
      communityId: communityA,
      agent: { kind: "existing", agentId: existing?.id ?? "" },
      scopes: ["posts:read", "posts:write"],
    });
    if (result.kind !== "redirect") throw new Error("expected redirect");
    const code = new URL(result.url).searchParams.get("code") ?? "";
    const tokens = await exchange(code);
    expect(tokens.scope).toBe("posts:read");
    expect((await agents.authenticate(tokens.access_token)).credential.scopes).toEqual([
      "posts:read",
    ]);
  });

  it("refuses to reuse another person's agent", async () => {
    const options = await oauth.consentOptions(user(ownerId));
    const ownersAgent = options[0]?.agents[0];
    await expect(
      oauth.approve(user(adminId), {
        request: authorizeParams(),
        communityId: communityA,
        agent: { kind: "existing", agentId: ownersAgent?.id ?? "" },
        scopes: ["posts:read"],
      }),
    ).rejects.toBeInstanceOf(ConsentError);
  });
});
