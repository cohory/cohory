import type { Actor, UserActor } from "@cohory/authz";
import { ForbiddenError } from "@cohory/authz";
import {
  addMembership,
  communitySlugSchema,
  createCommunity,
  createDb,
  createPool,
  leaveMembership,
  newId,
  parseAdminDatabaseEnv,
  runWithAuditSource,
  setMembershipStatus,
  setRlsValue,
  withCommunity,
  type CommunityId,
} from "@cohory/db";
import { agentIdentities, apiTokens, auditLog, users } from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentsError, InvalidTokenError } from "./errors";
import { createAgentsService } from "./service";
import { generateToken, hashToken } from "./token";

const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
const db = createDb(pool);
let clock = new Date("2026-10-19T10:00:00.000Z");
const service = createAgentsService({ db, now: () => clock });

let communityA: CommunityId;
let communityB: CommunityId;
let ownerId: string;
let adminId: string;
let memberId: string;

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

async function auditRows(communityId: string, action: string) {
  return db.transaction(async (tx) => {
    await setRlsValue(tx, "community_id", communityId);
    return tx
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.communityId, communityId), eq(auditLog.action, action)));
  });
}

beforeAll(async () => {
  const suffix = newId().slice(-12);
  communityA = (
    await createCommunity(db, {
      slug: communitySlugSchema.parse(`agents-a-${suffix}`),
      name: "Agents A",
    })
  ).id;
  communityB = (
    await createCommunity(db, {
      slug: communitySlugSchema.parse(`agents-b-${suffix}`),
      name: "Agents B",
    })
  ).id;
  ownerId = await insertUser("Owner");
  adminId = await insertUser("Admin");
  memberId = await insertUser("Member");
  const a = withCommunity(db, communityA);
  await addMembership(a, { userId: ownerId, role: "owner", status: "active" });
  await addMembership(a, { userId: adminId, role: "admin", status: "active" });
  await addMembership(a, { userId: memberId, role: "member", status: "active" });
  await addMembership(withCommunity(db, communityB), {
    userId: memberId,
    role: "member",
    status: "active",
  });
});

afterAll(async () => {
  await pool.end();
});

describe("personal tokens", () => {
  it("shows the token once, stores only its hash, and authenticates it", async () => {
    const created = await service.createPersonalToken(user(memberId), {
      communityId: communityA,
      name: "Zapier",
      scopes: ["posts:read", "posts:write"],
    });

    expect(created.token).toMatch(/^cohory_/);
    expect(created.view.prefix).toBe(created.token.slice(0, 12));
    expect(created.view.expiresAt.getTime() - clock.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
    const [stored] = await db.transaction(async (tx) => {
      await setRlsValue(tx, "community_id", communityA);
      return tx.select().from(apiTokens).where(eq(apiTokens.id, created.view.id));
    });
    expect(stored?.tokenHash).toBe(hashToken(created.token));
    expect(JSON.stringify(stored)).not.toContain(created.token.slice(7));

    const authenticated = await service.authenticate(created.token);
    expect(authenticated.userId).toBe(memberId);
    expect(authenticated.credential).toEqual({
      type: "user",
      tokenId: created.view.id,
      agentId: null,
      communityId: communityA,
      scopes: ["posts:read", "posts:write"],
      via: "api",
    });
    expect((await auditRows(communityA, "api_token.created")).length).toBeGreaterThan(0);
  });

  it("refuses the token on its next request once revoked", async () => {
    const created = await service.createPersonalToken(user(memberId), {
      communityId: communityA,
      name: "Revoke me",
      scopes: ["posts:read"],
    });
    await service.authenticate(created.token);

    await service.revokePersonalToken(user(memberId), created.view.id);

    await expect(service.authenticate(created.token)).rejects.toMatchObject({
      reason: "revoked",
    });
    const rows = await auditRows(communityA, "api_token.revoked");
    expect(rows.some((row) => row.target === created.view.id)).toBe(true);
  });

  it("refuses an expired token", async () => {
    const created = await service.createPersonalToken(user(memberId), {
      communityId: communityA,
      name: "Short",
      scopes: ["posts:read"],
      expiresInDays: 1,
    });
    const before = clock;
    clock = new Date(before.getTime() + 25 * 60 * 60 * 1000);
    try {
      await expect(service.authenticate(created.token)).rejects.toMatchObject({
        reason: "expired",
      });
    } finally {
      clock = before;
    }
  });

  it("refuses unknown and malformed tokens", async () => {
    await expect(service.authenticate(`cohory_${"A".repeat(43)}`)).rejects.toMatchObject({
      reason: "unknown",
    });
    await expect(service.authenticate("cohory_nope")).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("refuses a token whose owner left the community", async () => {
    const leaver = await insertUser("Leaver");
    await addMembership(withCommunity(db, communityB), {
      userId: leaver,
      role: "member",
      status: "active",
    });
    const created = await service.createPersonalToken(user(leaver), {
      communityId: communityB,
      name: "Left",
      scopes: ["posts:read"],
    });
    await setMembershipStatus(withCommunity(db, communityB), leaver, "removed");

    await expect(service.authenticate(created.token)).rejects.toMatchObject({
      reason: "membership_required",
    });
  });

  it("does not bring back a personal token when its owner leaves and joins again", async () => {
    const returning = await insertUser("Returning");
    await addMembership(withCommunity(db, communityB), {
      userId: returning,
      role: "member",
      status: "active",
      joinedAt: new Date(clock.getTime() - 86_400_000),
    });
    const before = await service.createPersonalToken(user(returning), {
      communityId: communityB,
      name: "Before leaving",
      scopes: ["posts:read"],
    });
    await leaveMembership(withCommunity(db, communityB), returning);
    await expect(service.authenticate(before.token)).rejects.toMatchObject({
      reason: "membership_required",
    });

    await setMembershipStatus(
      withCommunity(db, communityB),
      returning,
      "active",
      new Date(clock.getTime() + 60_000),
    );
    clock = new Date(clock.getTime() + 120_000);

    await expect(service.authenticate(before.token)).rejects.toMatchObject({ reason: "revoked" });
    const listed = await service.listPersonalTokens(user(returning));
    expect(listed.find((token) => token.id === before.view.id)?.state).toBe("revoked");
    const after = await service.createPersonalToken(user(returning), {
      communityId: communityB,
      name: "After joining again",
      scopes: ["posts:read"],
    });
    expect((await service.authenticate(after.token)).userId).toBe(returning);
  });

  it("shows a personal token as revoked while its owner is not a member", async () => {
    const away = await insertUser("Away");
    await addMembership(withCommunity(db, communityB), {
      userId: away,
      role: "member",
      status: "active",
    });
    const created = await service.createPersonalToken(user(away), {
      communityId: communityB,
      name: "Away",
      scopes: ["posts:read"],
    });
    await leaveMembership(withCommunity(db, communityB), away);

    const listed = await service.listPersonalTokens(user(away));
    expect(listed.find((token) => token.id === created.view.id)?.state).toBe("revoked");
  });

  it("lists only the caller's own personal tokens", async () => {
    const mine = await service.listPersonalTokens(user(memberId));
    const owners = await service.listPersonalTokens(user(ownerId));

    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((token) => token.kind === "personal")).toBe(true);
    expect(owners.some((token) => mine.some((other) => other.id === token.id))).toBe(false);
  });

  it("does not let one person revoke another person's token", async () => {
    const created = await service.createPersonalToken(user(memberId), {
      communityId: communityA,
      name: "Mine",
      scopes: ["posts:read"],
    });

    await expect(
      service.revokePersonalToken(user(ownerId), created.view.id),
    ).rejects.toBeInstanceOf(AgentsError);
  });

  it("does not let a token create or revoke tokens", async () => {
    const created = await service.createPersonalToken(user(memberId), {
      communityId: communityA,
      name: "Minter",
      scopes: ["posts:write"],
    });
    const viaToken: Actor = {
      ...user(memberId),
      credential: (await service.authenticate(created.token)).credential,
    };

    await expect(
      service.createPersonalToken(viaToken, {
        communityId: communityA,
        name: "Child",
        scopes: ["posts:write"],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.listPersonalTokens(viaToken)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("agents", () => {
  it("lets members create personal agents with read scopes only", async () => {
    await expect(
      service.createAgent(user(memberId), communityA, { name: "Nope", scopes: ["posts:write"] }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      service.createAgent(user(memberId), communityA, {
        name: "Wide",
        scopes: ["posts:read"],
        communityWide: true,
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    const personal = await service.createAgent(user(memberId), communityA, {
      name: "Reader",
      scopes: ["courses:read", "proposals:write"],
    });
    expect(personal.owner.id).toBe(memberId);
    expect((await service.listOwnAgents(user(memberId), communityA)).map((a) => a.id)).toContain(
      personal.id,
    );
    await expect(
      service.updateAgent(user(memberId), communityA, personal.id, { scopes: ["posts:write"] }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(service.listAgents(user(memberId), communityA)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("does not let members manage community wide agents of admins", async () => {
    const wide = await service.createAgent(user(adminId), communityA, {
      name: "Shared",
      scopes: ["posts:read"],
      communityWide: true,
    });
    await expect(
      service.updateAgent(user(memberId), communityA, wide.id, { status: "suspended" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("issues agent tokens that follow the agent's grants and status", async () => {
    const agent = await service.createAgent(user(adminId), communityA, {
      name: "Drafter",
      description: "Drafts announcements",
      scopes: ["posts:read", "posts:write"],
    });
    expect(agent.owner.id).toBe(adminId);
    const issued = await service.issueAgentToken(user(adminId), communityA, agent.id, {
      name: "Laptop",
    });

    const first = await service.authenticate(issued.token);
    expect(first.userId).toBe(adminId);
    expect(first.credential).toMatchObject({
      type: "agent",
      agentId: agent.id,
      scopes: ["posts:read", "posts:write"],
    });

    await service.updateAgent(user(adminId), communityA, agent.id, { scopes: ["posts:read"] });
    expect((await service.authenticate(issued.token)).credential.scopes).toEqual(["posts:read"]);

    await service.updateAgent(user(ownerId), communityA, agent.id, { status: "suspended" });
    await expect(service.authenticate(issued.token)).rejects.toMatchObject({
      reason: "agent_suspended",
    });

    await service.updateAgent(user(adminId), communityA, agent.id, { status: "active" });
    await service.authenticate(issued.token);

    await service.revokeAgent(user(adminId), communityA, agent.id);
    await expect(service.authenticate(issued.token)).rejects.toMatchObject({
      reason: "revoked",
    });
    const actions = (
      await Promise.all(
        ["agent.created", "agent.token_created", "agent.suspended", "agent.revoked"].map((action) =>
          auditRows(communityA, action),
        ),
      )
    ).map((rows) => rows.filter((row) => row.target === agent.id).length);
    expect(actions).toEqual([1, 1, 1, 1]);
  });

  it("records the last activity of an agent and its token", async () => {
    const agent = await service.createAgent(user(ownerId), communityA, {
      name: "Reader",
      scopes: ["posts:read"],
    });
    const issued = await service.issueAgentToken(user(ownerId), communityA, agent.id, {
      name: "Server",
    });

    await service.authenticate(issued.token);

    const [listed] = (await service.listAgents(user(ownerId), communityA)).filter(
      (view) => view.id === agent.id,
    );
    expect(listed?.lastActivityAt).toEqual(clock);
    expect(listed?.tokens[0]?.lastUsedAt).toEqual(clock);
  });

  it("revokes one agent token without touching the agent's other tokens", async () => {
    const agent = await service.createAgent(user(ownerId), communityA, {
      name: "Two keys",
      scopes: ["posts:read"],
    });
    const one = await service.issueAgentToken(user(ownerId), communityA, agent.id, { name: "1" });
    const two = await service.issueAgentToken(user(ownerId), communityA, agent.id, { name: "2" });

    await service.revokeAgentToken(user(ownerId), communityA, agent.id, one.view.id);

    await expect(service.authenticate(one.token)).rejects.toMatchObject({ reason: "revoked" });
    await expect(service.authenticate(two.token)).resolves.toBeDefined();
  });

  it("suspends an agent whose owner left the community", async () => {
    const leavingAdmin = await insertUser("Leaving admin");
    await addMembership(withCommunity(db, communityA), {
      userId: leavingAdmin,
      role: "admin",
      status: "active",
    });
    const agent = await service.createAgent(user(leavingAdmin), communityA, {
      name: "Orphan",
      scopes: ["posts:read"],
    });
    const issued = await service.issueAgentToken(user(leavingAdmin), communityA, agent.id, {
      name: "Key",
    });
    await setMembershipStatus(withCommunity(db, communityA), leavingAdmin, "removed");

    await expect(service.authenticate(issued.token)).rejects.toMatchObject({
      reason: "agent_suspended",
    });
    const [row] = await db.transaction(async (tx) => {
      await setRlsValue(tx, "community_id", communityA);
      return tx.select().from(agentIdentities).where(eq(agentIdentities.id, agent.id));
    });
    expect(row?.status).toBe("suspended");
  });

  it("keeps a personal agent that can propose purchases when its owner's membership ends", async () => {
    const lapsing = await insertUser("Lapsing member");
    await addMembership(withCommunity(db, communityA), {
      userId: lapsing,
      role: "member",
      status: "active",
    });
    const agent = await service.createAgent(user(lapsing), communityA, {
      name: "Shopper",
      scopes: ["courses:read", "proposals:write"],
    });
    const issued = await service.issueAgentToken(user(lapsing), communityA, agent.id, {
      name: "Key",
    });
    await setMembershipStatus(withCommunity(db, communityA), lapsing, "removed");

    const authenticated = await service.authenticate(issued.token);

    expect(authenticated.standing).toBe("lapsed");
    expect(authenticated.credential.scopes).toEqual(["courses:read", "proposals:write"]);
    const [row] = await db.transaction(async (tx) => {
      await setRlsValue(tx, "community_id", communityA);
      return tx.select().from(agentIdentities).where(eq(agentIdentities.id, agent.id));
    });
    expect(row?.status).toBe("active");

    await setMembershipStatus(withCommunity(db, communityA), lapsing, "banned");
    await expect(service.authenticate(issued.token)).rejects.toMatchObject({
      reason: "agent_suspended",
    });
  });

  it("lets an admin manage only their own or community wide agents", async () => {
    const ownersAgent = await service.createAgent(user(ownerId), communityA, {
      name: "Owner only",
      scopes: ["posts:read"],
    });
    const shared = await service.createAgent(user(ownerId), communityA, {
      name: "Shared",
      scopes: ["posts:read"],
      communityWide: true,
    });

    await expect(
      service.updateAgent(user(adminId), communityA, ownersAgent.id, { status: "suspended" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await service.updateAgent(user(adminId), communityA, shared.id, { status: "suspended" });
    const listed = await service.listAgents(user(adminId), communityA);
    expect(listed.find((view) => view.id === ownersAgent.id)?.canManage).toBe(false);
    expect(listed.find((view) => view.id === shared.id)?.canManage).toBe(true);
  });

  it("issues agent tokens only to the person the agent acts for", async () => {
    const membersAgent = await service.createAgent(user(memberId), communityA, {
      name: "Member reader",
      scopes: ["posts:read"],
    });
    const ownersShared = await service.createAgent(user(ownerId), communityA, {
      name: "Owner shared",
      scopes: ["posts:read"],
      communityWide: true,
    });

    await expect(
      service.issueAgentToken(user(ownerId), communityA, membersAgent.id, { name: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.issueAgentToken(user(adminId), communityA, ownersShared.id, { name: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const own = await service.issueAgentToken(user(memberId), communityA, membersAgent.id, {
      name: "Mine",
    });
    expect((await service.authenticate(own.token)).userId).toBe(memberId);
    const minted = generateToken();
    await db.transaction(async (tx) => {
      await setRlsValue(tx, "community_id", communityA);
      await tx.insert(apiTokens).values({
        id: newId(),
        communityId: communityA,
        kind: "agent",
        userId: memberId,
        agentId: membersAgent.id,
        name: "Minted by someone else",
        tokenHash: minted.hash,
        prefix: minted.prefix,
        scopes: ["posts:read"],
        expiresAt: new Date(clock.getTime() + 86_400_000),
        createdBy: ownerId,
      });
    });
    await expect(service.authenticate(minted.token)).rejects.toMatchObject({ reason: "revoked" });

    const listed = await service.listAgents(user(ownerId), communityA);
    expect(listed.find((view) => view.id === membersAgent.id)?.canIssueTokens).toBe(false);
    expect(listed.find((view) => view.id === ownersShared.id)?.canIssueTokens).toBe(true);
  });

  it("lets a manager only narrow, pause, or revoke an agent someone else owns", async () => {
    const membersAgent = await service.createAgent(user(memberId), communityA, {
      name: "Member helper",
      scopes: ["community:read", "posts:read"],
    });
    const ownersShared = await service.createAgent(user(ownerId), communityA, {
      name: "Owner wide",
      scopes: ["posts:read"],
      communityWide: true,
    });

    await expect(
      service.updateAgent(user(ownerId), communityA, membersAgent.id, {
        scopes: ["posts:read", "posts:write"],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      service.updateAgent(user(ownerId), communityA, membersAgent.id, { communityWide: true }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      service.updateAgent(user(adminId), communityA, ownersShared.id, {
        scopes: ["posts:read", "posts:write"],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });

    await service.updateAgent(user(ownerId), communityA, membersAgent.id, {
      scopes: ["posts:read"],
    });
    await service.updateAgent(user(ownerId), communityA, membersAgent.id, { status: "suspended" });
    await expect(
      service.updateAgent(user(ownerId), communityA, membersAgent.id, { status: "active" }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    const [row] = await db.transaction(async (tx) => {
      await setRlsValue(tx, "community_id", communityA);
      return tx.select().from(agentIdentities).where(eq(agentIdentities.id, membersAgent.id));
    });
    expect(row).toMatchObject({
      scopes: ["posts:read"],
      communityWide: false,
      status: "suspended",
    });

    await service.updateAgent(user(memberId), communityA, membersAgent.id, { status: "active" });
    await service.revokeAgent(user(ownerId), communityA, membersAgent.id);
  });

  it("does not find an agent of another community", async () => {
    const agent = await service.createAgent(user(ownerId), communityA, {
      name: "Tenant A",
      scopes: ["posts:read"],
    });
    await addMembership(withCommunity(db, communityB), {
      userId: ownerId,
      role: "owner",
      status: "active",
    });

    await expect(
      service.issueAgentToken(user(ownerId), communityB, agent.id, { name: "Cross" }),
    ).rejects.toBeInstanceOf(AgentsError);
  });
});

describe("api write audit", () => {
  it("records a token write with actor type, via, token, agent, and owning human", async () => {
    const agent = await service.createAgent(user(ownerId), communityA, {
      name: "Auditor",
      scopes: ["posts:write"],
    });
    const issued = await service.issueAgentToken(user(ownerId), communityA, agent.id, {
      name: "Key",
    });
    const { credential, userId } = await service.authenticate(issued.token);

    await runWithAuditSource(
      { actorType: "agent", via: "api", tokenId: credential.tokenId, agentId: agent.id },
      () =>
        service.recordApiWrite(credential, userId, {
          operationId: "createPost",
          method: "POST",
          path: "/api/v1/communities/x/posts",
          status: 201,
        }),
    );

    const rows = (await auditRows(communityA, "api.create_post")).filter(
      (row) => row.agentId === agent.id,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: ownerId,
      actorType: "agent",
      via: "api",
      tokenId: credential.tokenId,
      agentId: agent.id,
    });
  });
});
