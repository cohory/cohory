import type { UserActor } from "@cohory/authz";
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
  type Transaction,
} from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import { apiTokens, oauthClients, oauthGrants, oauthRefreshTokens, users } from "@cohory/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { oauthIssuer } from "./metadata";
import { createOAuthClientPrune } from "./prune";
import { s256Challenge } from "./secrets";
import { createOAuthService } from "./service";

const probeRole = "cohory_oauth_rls_probe";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const pool = createPool(adminUrl);
const db = createDb(pool);
const probeUrl = new URL(adminUrl);
probeUrl.searchParams.set("options", `-c role=${probeRole}`);
const probePool = createPool(probeUrl.toString());
const probeDb = createDb(probePool);

const dayMs = 24 * 60 * 60 * 1000;
const registeredAt = new Date("2020-01-01T10:00:00.000Z");
const pruneAt = new Date(registeredAt.getTime() + 60 * dayMs);
let clock = registeredAt;
const issuer = oauthIssuer("https://learn.example.com");
const oauth = createOAuthService({ db: probeDb, issuer, now: () => clock });

const verifier = "p".repeat(50);
const redirectUri = "https://client.example.com/callback";
let community: CommunityId;
let ownerId: string;

function user(userId: string): UserActor {
  return { kind: "user", userId, platformAdmin: false };
}

async function register(name: string, at: Date): Promise<string> {
  clock = at;
  const client = await oauth.register({ client_name: name, redirect_uris: [redirectUri] });
  return client.client_id;
}

async function connect(clientId: string, at: Date): Promise<{ refresh: string; grantId: string }> {
  clock = at;
  const result = await oauth.approve(user(ownerId), {
    request: {
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: s256Challenge(verifier),
      code_challenge_method: "S256",
      resource: issuer.resource,
    },
    communityId: community,
    agent: { kind: "new", name: `Prune ${newId().slice(-8)}` },
    scopes: ["posts:read"],
  });
  if (result.kind !== "redirect") throw new Error(result.message);
  const tokens = await oauth.token({
    grant_type: "authorization_code",
    client_id: clientId,
    code: new URL(result.url).searchParams.get("code") ?? "",
    code_verifier: verifier,
    redirect_uri: redirectUri,
    resource: issuer.resource,
  });
  const grants = await inCommunity((tx) =>
    tx.select({ id: oauthGrants.id }).from(oauthGrants).where(eq(oauthGrants.clientId, clientId)),
  );
  const grant = grants[0];
  if (!grant) throw new Error("no grant");
  return { refresh: tokens.refresh_token, grantId: grant.id };
}

async function disconnect(clientId: string, refresh: string, at: Date): Promise<void> {
  clock = at;
  await oauth.revoke({ client_id: clientId, token: refresh });
}

function inCommunity<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await setRlsValue(tx, "community_id", community);
    return fn(tx);
  });
}

async function remainingClients(ids: readonly string[]): Promise<string[]> {
  const rows = await db
    .select({ id: oauthClients.id })
    .from(oauthClients)
    .where(inArray(oauthClients.id, [...ids]));
  return rows.map((row) => row.id);
}

const prune = createOAuthClientPrune({
  db: probeDb,
  now: () => pruneAt,
  communities: async () => [community],
});

let unused: string;
let young: string;
let ended: { id: string; grantId: string };
let liveToken: string;
let recent: string;
let connected: string;

beforeAll(async () => {
  await db.execute(
    sql.raw(`
    select pg_advisory_xact_lock(${migrationLockKey});
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
        create role ${probeRole} nologin nosuperuser nobypassrls;
      end if;
    end $$;
    grant usage on schema public to ${probeRole};
    grant select, insert, update, delete on all tables in schema public to ${probeRole};
  `),
  );
  community = (
    await createCommunity(db, {
      slug: communitySlugSchema.parse(`oauth-prune-${newId().slice(-12)}`),
      name: "Prune",
    })
  ).id;
  const [owner] = await db
    .insert(users)
    .values({ name: "Prune owner", email: `oauth-prune-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!owner) throw new Error("no user");
  ownerId = owner.id;
  await addMembership(withCommunity(db, community), {
    userId: ownerId,
    role: "owner",
    status: "active",
  });

  unused = await register("Never used", registeredAt);
  young = await register("Registered last week", new Date(pruneAt.getTime() - 10 * dayMs));

  const endedId = await register("Ended long ago", registeredAt);
  const endedGrant = await connect(endedId, registeredAt);
  await disconnect(endedId, endedGrant.refresh, new Date(registeredAt.getTime() + dayMs));
  ended = { id: endedId, grantId: endedGrant.grantId };

  liveToken = await register("Live token", registeredAt);
  const liveGrant = await connect(liveToken, registeredAt);
  await disconnect(liveToken, liveGrant.refresh, new Date(registeredAt.getTime() + dayMs));
  await inCommunity((tx) =>
    tx
      .update(apiTokens)
      .set({ revokedAt: null, expiresAt: new Date(pruneAt.getTime() + dayMs) })
      .where(eq(apiTokens.oauthGrantId, liveGrant.grantId)),
  );

  recent = await register("Used this month", registeredAt);
  const recentGrant = await connect(recent, new Date(pruneAt.getTime() - 20 * dayMs));
  await disconnect(recent, recentGrant.refresh, new Date(pruneAt.getTime() - 19 * dayMs));

  connected = await register("Still connected", registeredAt);
  await connect(connected, registeredAt);
});

afterAll(async () => {
  await probePool.end();
  await pool.end();
});

describe("pruning registered OAuth clients", () => {
  it("deletes old unused clients and ended connections, keeps clients in use", async () => {
    const result = await prune();

    expect(result.pruned).toBeGreaterThanOrEqual(2);
    expect(
      new Set(await remainingClients([unused, young, ended.id, liveToken, recent, connected])),
    ).toEqual(new Set([young, liveToken, recent, connected]));
  });

  it("removes the deleted client's grants, refresh tokens, and access tokens with it", async () => {
    const left = await inCommunity(async (tx) => ({
      grants: await tx.select().from(oauthGrants).where(eq(oauthGrants.id, ended.grantId)),
      refresh: await tx
        .select()
        .from(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.grantId, ended.grantId)),
      access: await tx.select().from(apiTokens).where(eq(apiTokens.oauthGrantId, ended.grantId)),
    }));
    expect(left).toEqual({ grants: [], refresh: [], access: [] });
  });

  it("deletes at most one batch per run", async () => {
    const first = await register("Batch one", registeredAt);
    const second = await register("Batch two", registeredAt);
    const result = await createOAuthClientPrune({
      db: probeDb,
      now: () => pruneAt,
      communities: async () => [community],
      batchSize: 1,
    })();

    expect(result.pruned).toBe(1);
    expect(await remainingClients([first, second])).toHaveLength(1);
  });

  it("deletes nothing more on a second run", async () => {
    const before = await remainingClients([young, liveToken, recent, connected]);
    await prune();
    expect(await remainingClients([young, liveToken, recent, connected])).toEqual(before);
  });
});
