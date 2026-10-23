import type { UserActor } from "@cohory/authz";
import {
  addMembership,
  communitySlugSchema,
  createCommunity,
  createDb,
  createPool,
  newId,
  parseAdminDatabaseEnv,
  withCommunity,
  type CommunityId,
  type Transaction,
} from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import { oauthAuthorizationCodes, oauthGrants, oauthRefreshTokens, users } from "@cohory/db/schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAgentsService } from "../service";
import { hashToken } from "../token";
import { oauthIssuer } from "./metadata";
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
const issuer = oauthIssuer("https://learn.example.com");
const oauth = createOAuthService({ db: probeDb, issuer });
const agents = createAgentsService({ db: probeDb });

const verifier = "v".repeat(50);
const redirectUri = "https://client.example.com/callback";
let communityA: CommunityId;
let communityB: CommunityId;
let ownerA: string;
let ownerB: string;
let refreshA = "";

function user(userId: string): UserActor {
  return { kind: "user", userId, platformAdmin: false };
}

async function asProbe<T>(
  settings: Record<string, string>,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local role ${probeRole}`));
    for (const [name, value] of Object.entries(settings)) {
      await tx.execute(sql`select set_config(${name}, ${value}, true)`);
    }
    return fn(tx);
  });
}

async function insertUser(): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ name: "OAuth RLS", email: `oauth-rls-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!row) throw new Error("no user");
  return row.id;
}

async function connect(ownerId: string, communityId: string, clientId: string) {
  const result = await oauth.approve(user(ownerId), {
    request: {
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: s256Challenge(verifier),
      code_challenge_method: "S256",
      resource: issuer.resource,
    },
    communityId,
    agent: { kind: "new", name: "Probe agent" },
    scopes: ["posts:read"],
  });
  if (result.kind !== "redirect") throw new Error(result.message);
  return oauth.token({
    grant_type: "authorization_code",
    client_id: clientId,
    code: new URL(result.url).searchParams.get("code") ?? "",
    code_verifier: verifier,
    redirect_uri: redirectUri,
    resource: issuer.resource,
  });
}

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
  const suffix = newId().slice(-12);
  communityA = (
    await createCommunity(db, {
      slug: communitySlugSchema.parse(`oauth-rls-a-${suffix}`),
      name: "A",
    })
  ).id;
  communityB = (
    await createCommunity(db, {
      slug: communitySlugSchema.parse(`oauth-rls-b-${suffix}`),
      name: "B",
    })
  ).id;
  ownerA = await insertUser();
  ownerB = await insertUser();
  await addMembership(withCommunity(db, communityA), {
    userId: ownerA,
    role: "owner",
    status: "active",
  });
  await addMembership(withCommunity(db, communityB), {
    userId: ownerB,
    role: "owner",
    status: "active",
  });
  const client = await oauth.register({ client_name: "Probe", redirect_uris: [redirectUri] });
  const a = await connect(ownerA, communityA, client.client_id);
  await connect(ownerB, communityB, client.client_id);
  refreshA = a.refresh_token;
  const rotated = await oauth.token({
    grant_type: "refresh_token",
    client_id: client.client_id,
    refresh_token: a.refresh_token,
  });
  await agents.authenticate(rotated.access_token);
});

afterAll(async () => {
  await probePool.end();
  await pool.end();
});

describe("row level security on oauth tables", () => {
  it.each(["oauth_grants", "oauth_authorization_codes", "oauth_refresh_tokens"])(
    "is enabled and forced on %s",
    async (table) => {
      const result = await db.execute<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = ${table}`,
      );
      expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    },
  );

  it("runs the whole flow as a role without bypass, and lists apps per owner", async () => {
    const apps = await oauth.listMyConnectedApps(user(ownerA));
    expect(apps.map((app) => app.community.id)).toEqual([communityA]);
    const managed = await oauth.listConnectedApps(user(ownerB), communityB);
    expect(managed).toHaveLength(1);
  });

  it("returns no rows without a community or lookup setting", async () => {
    const counts = await asProbe({}, async (tx) => [
      (await tx.select().from(oauthGrants)).length,
      (await tx.select().from(oauthAuthorizationCodes)).length,
      (await tx.select().from(oauthRefreshTokens)).length,
    ]);
    expect(counts).toEqual([0, 0, 0]);
  });

  it("scopes rows to app.community_id", async () => {
    const grants = await asProbe({ "app.community_id": communityA }, (tx) =>
      tx.select().from(oauthGrants),
    );
    expect(grants.length).toBeGreaterThan(0);
    expect(grants.every((grant) => grant.communityId === communityA)).toBe(true);
  });

  it("finds exactly the refresh token whose hash is in app.oauth_secret_hash", async () => {
    const rows = await asProbe({ "app.oauth_secret_hash": hashToken(refreshA) }, (tx) =>
      tx.select().from(oauthRefreshTokens),
    );
    expect(rows.map((row) => row.communityId)).toEqual([communityA]);
  });

  it("shows a person only their own grants through app.oauth_grant_owner", async () => {
    const rows = await asProbe({ "app.oauth_grant_owner": ownerB }, (tx) =>
      tx.select().from(oauthGrants),
    );
    expect(rows.every((row) => row.userId === ownerB)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });
});
