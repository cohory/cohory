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
import { agentIdentities, apiTokens, postDrafts, users } from "@cohory/db/schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAgentsService } from "./service";
import { hashToken } from "./token";

const probeRole = "cohory_agents_rls_probe";
const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
const db = createDb(pool);
const service = createAgentsService({ db });

let communityA: CommunityId;
let communityB: CommunityId;
let ownerA: string;
let ownerB: string;
let tokenA = "";
let tokenB = "";

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
    .values({ name: "RLS", email: `rls-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!row) throw new Error("no user");
  return row.id;
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
    grant select, insert, update, delete on api_tokens, agent_identities, post_drafts to ${probeRole};
  `),
  );
  const suffix = newId().slice(-12);
  communityA = (
    await createCommunity(db, { slug: communitySlugSchema.parse(`rls-ag-a-${suffix}`), name: "A" })
  ).id;
  communityB = (
    await createCommunity(db, { slug: communitySlugSchema.parse(`rls-ag-b-${suffix}`), name: "B" })
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
  const actorA = { kind: "user", userId: ownerA, platformAdmin: false } as const;
  const actorB = { kind: "user", userId: ownerB, platformAdmin: false } as const;
  tokenA = (
    await service.createPersonalToken(actorA, {
      communityId: communityA,
      name: "A",
      scopes: ["posts:read"],
    })
  ).token;
  tokenB = (
    await service.createPersonalToken(actorB, {
      communityId: communityB,
      name: "B",
      scopes: ["posts:read"],
    })
  ).token;
  const agent = await service.createAgent(actorA, communityA, {
    name: "Agent A",
    scopes: ["posts:read"],
  });
  await service.issueAgentToken(actorA, communityA, agent.id, { name: "Agent key" });
  await service.createAgent(actorB, communityB, { name: "Agent B", scopes: ["posts:read"] });
});

afterAll(async () => {
  await pool.end();
});

describe("row level security on agent tables", () => {
  it.each(["api_tokens", "agent_identities", "post_drafts"])(
    "is enabled and forced on %s",
    async (table) => {
      const result = await db.execute<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = ${table}`,
      );

      expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    },
  );

  it("returns no rows without a community or lookup setting", async () => {
    const counts = await asProbe({}, async (tx) => [
      (await tx.select().from(apiTokens)).length,
      (await tx.select().from(agentIdentities)).length,
      (await tx.select().from(postDrafts)).length,
    ]);

    expect(counts).toEqual([0, 0, 0]);
  });

  it("returns only rows of the community in app.community_id", async () => {
    const rows = await asProbe({ "app.community_id": communityA }, async (tx) => ({
      tokens: await tx.select().from(apiTokens),
      agents: await tx.select().from(agentIdentities),
    }));

    expect(rows.tokens.length).toBe(2);
    expect(rows.tokens.every((row) => row.communityId === communityA)).toBe(true);
    expect(rows.agents.map((row) => row.name)).toEqual(["Agent A"]);
  });

  it("finds exactly the token whose hash is in app.api_token_hash", async () => {
    const rows = await asProbe({ "app.api_token_hash": hashToken(tokenB) }, (tx) =>
      tx.select().from(apiTokens),
    );

    expect(rows.map((row) => row.communityId)).toEqual([communityB]);
  });

  it("shows a person only their own personal tokens through app.api_token_owner", async () => {
    const rows = await asProbe({ "app.api_token_owner": ownerA }, (tx) =>
      tx.select().from(apiTokens),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("personal");
    expect(rows[0]?.userId).toBe(ownerA);
    expect(tokenA).not.toBe("");
  });

  it("refuses to write an agent into another community", async () => {
    await expect(
      asProbe({ "app.community_id": communityA }, (tx) =>
        tx.insert(agentIdentities).values({
          communityId: communityB,
          ownerId: ownerA,
          name: "Smuggled",
          createdBy: ownerA,
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });
});
