import { ForbiddenError, type UserActor } from "@cohory/authz";
import {
  addMembership,
  communitySlugSchema,
  createCommunity,
  createDb,
  createPool,
  newId,
  parseAdminDatabaseEnv,
  setMembershipStatus,
  setRlsValue,
  withCommunity,
  type CommunityId,
} from "@cohory/db";
import {
  agentIdentities,
  apiTokens,
  auditLog,
  communities,
  notifications,
  users,
} from "@cohory/db/schema";
import {
  createNotificationsService,
  createTokenExpiryNotifier,
  tokenExpiryNotificationId,
  type TokenExpiryNotifier,
  type TokenExpiryNotifierDeps,
} from "@cohory/notifications";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentsError, ScopeNotAvailableError } from "./errors";
import { createTokenExpirySweep } from "./expiry";
import { createAgentsService } from "./service";

const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
const db = createDb(pool);
const dayMs = 24 * 60 * 60 * 1000;
let clock = new Date("2027-03-01T10:00:00.000Z");
const now = () => clock;
const service = createAgentsService({ db, now });

let communityA: CommunityId;
let communityB: CommunityId;
let communityASlug: string;
let ownerId: string;
let adminId: string;
let moderatorId: string;
let memberId: string;
let outsiderId: string;

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

async function inA<T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) {
  return db.transaction(async (tx) => {
    await setRlsValue(tx, "community_id", communityA);
    return fn(tx);
  });
}

beforeAll(async () => {
  const suffix = newId().slice(-12);
  communityASlug = `tokens-a-${suffix}`;
  communityA = (
    await createCommunity(db, { slug: communitySlugSchema.parse(communityASlug), name: "Tokens A" })
  ).id;
  communityB = (
    await createCommunity(db, {
      slug: communitySlugSchema.parse(`tokens-b-${suffix}`),
      name: "Tokens B",
    })
  ).id;
  ownerId = await insertUser("Owner");
  adminId = await insertUser("Admin");
  moderatorId = await insertUser("Moderator");
  memberId = await insertUser("Member");
  outsiderId = await insertUser("Outsider");
  const a = withCommunity(db, communityA);
  await addMembership(a, { userId: ownerId, role: "owner", status: "active" });
  await addMembership(a, { userId: adminId, role: "admin", status: "active" });
  await addMembership(a, { userId: moderatorId, role: "moderator", status: "active" });
  await addMembership(a, { userId: memberId, role: "member", status: "active" });
  await addMembership(withCommunity(db, communityB), {
    userId: outsiderId,
    role: "owner",
    status: "active",
  });
});

afterAll(async () => {
  await pool.end();
});

describe("editing an agent's permissions", () => {
  it("lets the agent's person narrow and widen within what their role allows", async () => {
    const agent = await service.createAgent(user(memberId), communityA, {
      name: "Study buddy",
      scopes: ["community:read", "courses:read"],
    });
    await service.updateAgent(user(memberId), communityA, agent.id, {
      scopes: ["community:read", "courses:read", "events:read"],
    });
    await service.updateAgent(user(memberId), communityA, agent.id, { scopes: ["courses:read"] });
    await expect(
      service.updateAgent(user(memberId), communityA, agent.id, {
        scopes: ["courses:read", "posts:write"],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    const [view] = await service.listOwnAgents(user(memberId), communityA);
    expect(view?.scopes).toEqual(["courses:read"]);
  });

  it("lets the owner narrow a member's agent but not widen it", async () => {
    const agent = await service.createAgent(user(memberId), communityA, {
      name: "Reader two",
      scopes: ["community:read", "posts:read"],
    });
    await expect(
      service.updateAgent(user(ownerId), communityA, agent.id, {
        scopes: ["community:read", "posts:read", "events:read"],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await service.updateAgent(user(ownerId), communityA, agent.id, { scopes: ["posts:read"] });
    const listed = await service.listAgents(user(ownerId), communityA);
    expect(listed.find((view) => view.id === agent.id)?.scopes).toEqual(["posts:read"]);
  });

  it("lets an admin narrow a community wide agent of the owner but not widen it", async () => {
    const agent = await service.createAgent(user(ownerId), communityA, {
      name: "Shared helper",
      scopes: ["posts:read", "posts:write"],
      communityWide: true,
    });
    await expect(
      service.updateAgent(user(adminId), communityA, agent.id, {
        scopes: ["posts:read", "posts:write", "settings:read"],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await service.updateAgent(user(adminId), communityA, agent.id, { scopes: ["posts:read"] });
  });

  it("does not let a moderator change another person's agent", async () => {
    const agent = await service.createAgent(user(memberId), communityA, {
      name: "Not yours",
      scopes: ["posts:read"],
    });
    await expect(
      service.updateAgent(user(moderatorId), communityA, agent.id, {
        scopes: ["community:read"],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not let another community's owner change the agent", async () => {
    const agent = await service.createAgent(user(ownerId), communityA, {
      name: "Tenant bound",
      scopes: ["posts:read"],
    });
    await expect(
      service.updateAgent(user(outsiderId), communityB, agent.id, { scopes: ["posts:read"] }),
    ).rejects.toBeInstanceOf(AgentsError);
    await expect(
      service.updateAgent(user(outsiderId), communityA, agent.id, { scopes: ["posts:read"] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("applies a narrowed permission to the agent's existing token on its next request", async () => {
    const agent = await service.createAgent(user(ownerId), communityA, {
      name: "Narrowed",
      scopes: ["posts:read", "posts:write"],
    });
    const issued = await service.issueAgentToken(user(ownerId), communityA, agent.id, {
      name: "Server",
    });
    await service.updateAgent(user(ownerId), communityA, agent.id, { scopes: ["posts:read"] });
    expect((await service.authenticate(issued.token)).credential.scopes).toEqual(["posts:read"]);
  });
});

describe("regenerating a personal token", () => {
  it("keeps the name, community, scopes, and lifetime, and ends the old token", async () => {
    const created = await service.createPersonalToken(user(memberId), {
      communityId: communityA,
      name: "Nightly sync",
      scopes: ["posts:read", "comments:read"],
      expiresInDays: 30,
    });
    clock = new Date(clock.getTime() + 25 * dayMs);

    const regenerated = await service.regeneratePersonalToken(user(memberId), created.view.id);

    expect(regenerated.token).not.toBe(created.token);
    expect(regenerated.view).toMatchObject({
      name: "Nightly sync",
      communityId: communityA,
      scopes: ["posts:read", "comments:read"],
      state: "active",
      community: { slug: communityASlug, name: "Tokens A" },
    });
    expect(regenerated.view.expiresAt.getTime() - clock.getTime()).toBe(30 * dayMs);
    await expect(service.authenticate(created.token)).rejects.toMatchObject({ reason: "revoked" });
    expect((await service.authenticate(regenerated.token)).userId).toBe(memberId);
    const audit = await inA((tx) =>
      tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "api_token.regenerated"),
            eq(auditLog.target, regenerated.view.id),
          ),
        ),
    );
    expect(audit[0]?.metadata).toMatchObject({ replaces: created.view.id });
  });

  it("regenerates an expired token", async () => {
    const created = await service.createPersonalToken(user(memberId), {
      communityId: communityA,
      name: "Lapsed",
      scopes: ["posts:read"],
      expiresInDays: 1,
    });
    clock = new Date(clock.getTime() + 2 * dayMs);
    const regenerated = await service.regeneratePersonalToken(user(memberId), created.view.id);
    expect(regenerated.view.state).toBe("active");
  });

  it("refuses another person's token, a revoked token, and a token after leaving", async () => {
    const created = await service.createPersonalToken(user(memberId), {
      communityId: communityA,
      name: "Mine only",
      scopes: ["posts:read"],
    });
    await expect(
      service.regeneratePersonalToken(user(ownerId), created.view.id),
    ).rejects.toBeInstanceOf(AgentsError);
    await expect(
      service.regeneratePersonalToken(user(outsiderId), created.view.id),
    ).rejects.toBeInstanceOf(AgentsError);

    await service.revokePersonalToken(user(memberId), created.view.id);
    await expect(
      service.regeneratePersonalToken(user(memberId), created.view.id),
    ).rejects.toMatchObject({ code: "validation_failed" });

    const leaver = await insertUser("Leaver");
    await addMembership(withCommunity(db, communityA), {
      userId: leaver,
      role: "member",
      status: "active",
    });
    const left = await service.createPersonalToken(user(leaver), {
      communityId: communityA,
      name: "Gone",
      scopes: ["posts:read"],
    });
    await setMembershipStatus(withCommunity(db, communityA), leaver, "removed");
    await expect(
      service.regeneratePersonalToken(user(leaver), left.view.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("regenerating an agent token", () => {
  it("lets only the agent's person regenerate, keeping the name and the agent's permissions", async () => {
    const agent = await service.createAgent(user(memberId), communityA, {
      name: "Course reader",
      scopes: ["courses:read"],
    });
    const issued = await service.issueAgentToken(user(memberId), communityA, agent.id, {
      name: "Laptop",
      expiresInDays: 90,
    });

    await expect(
      service.regenerateAgentToken(user(ownerId), communityA, agent.id, issued.view.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.regenerateAgentToken(user(moderatorId), communityA, agent.id, issued.view.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.regenerateAgentToken(user(outsiderId), communityB, agent.id, issued.view.id),
    ).rejects.toBeInstanceOf(AgentsError);

    const regenerated = await service.regenerateAgentToken(
      user(memberId),
      communityA,
      agent.id,
      issued.view.id,
    );
    expect(regenerated.view).toMatchObject({
      name: "Laptop",
      agentId: agent.id,
      scopes: ["courses:read"],
    });
    expect(regenerated.view.expiresAt.getTime() - clock.getTime()).toBe(90 * dayMs);
    await expect(service.authenticate(issued.token)).rejects.toMatchObject({ reason: "revoked" });
    expect((await service.authenticate(regenerated.token)).credential.agentId).toBe(agent.id);
  });

  it("refuses a community wide agent's token to an admin who is not its person", async () => {
    const agent = await service.createAgent(user(ownerId), communityA, {
      name: "Wide",
      scopes: ["posts:read"],
      communityWide: true,
    });
    const issued = await service.issueAgentToken(user(ownerId), communityA, agent.id, {
      name: "Server",
    });
    await expect(
      service.regenerateAgentToken(user(adminId), communityA, agent.id, issued.view.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses while the agent is paused", async () => {
    const agent = await service.createAgent(user(ownerId), communityA, {
      name: "Paused",
      scopes: ["posts:read"],
    });
    const issued = await service.issueAgentToken(user(ownerId), communityA, agent.id, {
      name: "Server",
    });
    await service.updateAgent(user(ownerId), communityA, agent.id, { status: "suspended" });
    await expect(
      service.regenerateAgentToken(user(ownerId), communityA, agent.id, issued.view.id),
    ).rejects.toMatchObject({ code: "agent_not_active" });
  });
});

describe("permissions a role cannot use", () => {
  it("refuses a personal token permission the person's role cannot use", async () => {
    for (const scopes of [
      ["members:moderate"],
      ["proposals:write"],
      ["notifications:read"],
    ] as const) {
      await expect(
        service.createPersonalToken(user(memberId), {
          communityId: communityA,
          name: "Too much",
          scopes: [...scopes],
        }),
      ).rejects.toMatchObject({ code: "scope_not_available", scopes: [...scopes] });
    }
    await expect(
      service.createPersonalToken(user(adminId), {
        communityId: communityA,
        name: "Export",
        scopes: ["members:export"],
      }),
    ).rejects.toBeInstanceOf(ScopeNotAvailableError);
    const owners = await service.createPersonalToken(user(ownerId), {
      communityId: communityA,
      name: "Export",
      scopes: ["members:export"],
    });
    expect(owners.view.scopes).toEqual(["members:export"]);
  });

  it("refuses an agent permission the creator's role cannot use", async () => {
    await expect(
      service.createAgent(user(adminId), communityA, {
        name: "Exporter",
        scopes: ["posts:read", "members:export"],
      }),
    ).rejects.toMatchObject({ code: "scope_not_available", scopes: ["members:export"] });
    await expect(
      service.createAgent(user(adminId), communityA, {
        name: "Reserved",
        scopes: ["notifications:read"],
      }),
    ).rejects.toMatchObject({ code: "scope_not_available" });
    await expect(
      service.createAgent(user(moderatorId), communityA, {
        name: "Moderator helper",
        scopes: ["members:moderate"],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    const owners = await service.createAgent(user(ownerId), communityA, {
      name: "Owner exporter",
      scopes: ["members:export", "proposals:write"],
    });
    expect(owners.scopes).toEqual(["members:export", "proposals:write"]);
  });

  it("checks only the permissions an edit adds, so narrowing keeps working", async () => {
    const agent = await service.createAgent(user(adminId), communityA, {
      name: "Legacy",
      scopes: ["posts:read", "comments:read"],
    });
    await inA((tx) =>
      tx
        .update(agentIdentities)
        .set({ scopes: ["posts:read", "comments:read", "members:export"] })
        .where(eq(agentIdentities.id, agent.id)),
    );
    await expect(
      service.updateAgent(user(adminId), communityA, agent.id, {
        scopes: ["posts:read", "comments:read", "members:export", "notifications:read"],
      }),
    ).rejects.toMatchObject({ code: "scope_not_available", scopes: ["notifications:read"] });
    await service.updateAgent(user(adminId), communityA, agent.id, {
      scopes: ["posts:read", "members:export"],
    });
    const listed = await service.listAgents(user(adminId), communityA);
    expect(listed.find((view) => view.id === agent.id)?.scopes).toEqual([
      "posts:read",
      "members:export",
    ]);
  });
});

describe("creating an agent with its first token", () => {
  it("creates both in one step and the token works at once", async () => {
    const created = await service.createAgentWithToken(user(memberId), communityA, {
      name: "One step",
      scopes: ["courses:read"],
      token: { name: "Main token", expiresInDays: 30 },
    });
    expect(created.agent).toMatchObject({ name: "One step", scopes: ["courses:read"] });
    expect(created.token.view).toMatchObject({ name: "Main token", agentId: created.agent.id });
    expect((await service.authenticate(created.token.token)).credential.agentId).toBe(
      created.agent.id,
    );
  });

  it("creates neither when the agent is refused", async () => {
    await expect(
      service.createAgentWithToken(user(memberId), communityA, {
        name: "Refused",
        scopes: ["posts:write"],
        token: { name: "Main token", expiresInDays: 30 },
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    const own = await service.listOwnAgents(user(memberId), communityA);
    expect(own.some((agent) => agent.name === "Refused")).toBe(false);
  });
});

describe("last use", () => {
  it("records whether a token was last used through the API or MCP", async () => {
    const created = await service.createPersonalToken(user(adminId), {
      communityId: communityA,
      name: "Assistant",
      scopes: ["posts:read"],
    });
    await service.authenticate(created.token, "mcp");
    let [listed] = (await service.listPersonalTokens(user(adminId))).filter(
      (token) => token.id === created.view.id,
    );
    expect(listed).toMatchObject({ lastUsedAt: clock, lastUsedVia: "mcp", oauth: false });

    await service.authenticate(created.token);
    [listed] = (await service.listPersonalTokens(user(adminId))).filter(
      (token) => token.id === created.view.id,
    );
    expect(listed?.lastUsedVia).toBe("mcp");

    clock = new Date(clock.getTime() + 61_000);
    await service.authenticate(created.token);
    [listed] = (await service.listPersonalTokens(user(adminId))).filter(
      (token) => token.id === created.view.id,
    );
    expect(listed).toMatchObject({ lastUsedAt: clock, lastUsedVia: "api" });
  });
});

// Other packages fill the shared integration database with communities, and the
// sweep opens one transaction per community, so a full sweep outlasts the test timeout under load.
function ownCommunities() {
  return db
    .select({ id: communities.id, slug: communities.slug, name: communities.name })
    .from(communities)
    .where(inArray(communities.id, [communityA, communityB]));
}

describe("token expiry notice", () => {
  const sent: Parameters<TokenExpiryNotifierDeps["send"]>[0][] = [];
  const noticeErrors: unknown[] = [];
  const sweep = createTokenExpirySweep({
    db,
    now,
    communities: ownCommunities,
    onNoticeError: (_tokenId, error) => noticeErrors.push(error),
    notify: createTokenExpiryNotifier({
      db,
      now,
      appUrl: "https://cohory.test/",
      send: async (message) => {
        sent.push(message);
      },
    }),
  });

  async function noticesFor(tokenIds: readonly string[]) {
    return inA((tx) =>
      tx
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.type, "token_expiring"),
            inArray(notifications.subjectId, [...tokenIds]),
          ),
        ),
    );
  }

  it("tells the person once, 7 days before a token expires, and skips tokens that need no notice", async () => {
    const start = clock;
    const due = await service.createPersonalToken(user(ownerId), {
      communityId: communityA,
      name: "Weekly export",
      scopes: ["posts:read"],
      expiresInDays: 30,
    });
    const short = await service.createPersonalToken(user(ownerId), {
      communityId: communityA,
      name: "Five days",
      scopes: ["posts:read"],
      expiresInDays: 5,
    });
    const revoked = await service.createPersonalToken(user(ownerId), {
      communityId: communityA,
      name: "Revoked",
      scopes: ["posts:read"],
      expiresInDays: 30,
    });
    await service.revokePersonalToken(user(ownerId), revoked.view.id);
    const agent = await service.createAgent(user(ownerId), communityA, {
      name: "Sleeper",
      scopes: ["posts:read"],
    });
    const paused = await service.issueAgentToken(user(ownerId), communityA, agent.id, {
      name: "Paused token",
      expiresInDays: 30,
    });
    await service.updateAgent(user(ownerId), communityA, agent.id, { status: "suspended" });
    const ids = [due.view.id, short.view.id, revoked.view.id, paused.view.id];

    clock = new Date(start.getTime() + 22 * dayMs);
    await sweep();
    expect(await noticesFor(ids)).toEqual([]);

    clock = new Date(start.getTime() + 24 * dayMs);
    await sweep();
    await sweep();

    const rows = await noticesFor(ids);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: ownerId,
      subjectType: "api_token",
      subjectId: due.view.id,
    });
    expect(rows[0]?.detail).toMatch(/^Your token Weekly export expires on .+\. Regenerate it/);
    const [owner] = await db.select().from(users).where(eq(users.id, ownerId));
    const mails = sent.filter((message) => message.to === owner?.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.subject).toBe("[Tokens A] Your token Weekly export expires in 6 days");
    expect(mails[0]?.text).toContain("https://cohory.test/account/api-tokens");
    expect(mails[0]?.text).not.toContain(due.token);
    const [stored] = await inA((tx) =>
      tx.select().from(apiTokens).where(eq(apiTokens.id, due.view.id)),
    );
    expect(stored?.expiryNotifiedAt).toEqual(clock);
  });

  it("points an agent token notice to the person's agents", async () => {
    const start = clock;
    const agent = await service.createAgent(user(memberId), communityA, {
      name: "Digest bot",
      scopes: ["posts:read"],
    });
    const issued = await service.issueAgentToken(user(memberId), communityA, agent.id, {
      name: "Cron",
      expiresInDays: 30,
    });
    clock = new Date(start.getTime() + 24 * dayMs);
    await sweep();
    const second = await service.issueAgentToken(user(memberId), communityA, agent.id, {
      name: "Backup",
      expiresInDays: 30,
    });
    clock = new Date(clock.getTime() + 24 * dayMs);
    await sweep();
    const both = await noticesFor([issued.view.id, second.view.id]);
    expect(both.map((notice) => notice.subjectId).sort()).toEqual(
      [issued.view.id, second.view.id].sort(),
    );
    expect(noticeErrors).toEqual([]);
    const [row] = await inA((tx) =>
      tx
        .select()
        .from(notifications)
        .where(eq(notifications.id, tokenExpiryNotificationId(issued.view.id, memberId))),
    );
    expect(row).toMatchObject({ subjectType: "agent_token", subjectId: issued.view.id });
    expect(row?.detail).toMatch(/^Digest bot's token Cron expires on .+ Account, Agents\.$/);
    const inbox = await createNotificationsService({ db, now }).listNotifications(user(memberId));
    expect(inbox.data.find((item) => item.id === row?.id)?.href).toBe(
      `/account/agents?community=${communityASlug}`,
    );
    const [person] = await db.select().from(users).where(eq(users.id, memberId));
    const mail = sent.find(
      (message) => message.to === person?.email && message.subject.includes("Cron"),
    );
    expect(mail?.text).toContain(`/account/agents?community=${communityASlug}`);
  });

  it("tries again on the next run when a notice fails, and sends it once", async () => {
    const start = clock;
    const delivered: Parameters<TokenExpiryNotifierDeps["send"]>[0][] = [];
    let failNext = true;
    const notify: TokenExpiryNotifier = createTokenExpiryNotifier({
      db,
      now,
      appUrl: "https://cohory.test/",
      send: async (message) => {
        if (message.subject.includes("Flaky mail") && failNext) {
          failNext = false;
          throw new Error("smtp down");
        }
        delivered.push(message);
      },
    });
    const retrying = createTokenExpirySweep({
      db,
      now,
      notify,
      communities: ownCommunities,
    });
    const created = await service.createPersonalToken(user(moderatorId), {
      communityId: communityA,
      name: "Flaky mail",
      scopes: ["posts:read"],
      expiresInDays: 30,
    });
    clock = new Date(start.getTime() + 24 * dayMs);

    const first = await retrying();
    expect(first.failed).toBeGreaterThanOrEqual(1);
    expect(await noticesFor([created.view.id])).toEqual([]);
    const [pending] = await inA((tx) =>
      tx.select().from(apiTokens).where(eq(apiTokens.id, created.view.id)),
    );
    expect(pending?.expiryNotifiedAt).toBeNull();

    await retrying();
    await retrying();
    expect(await noticesFor([created.view.id])).toHaveLength(1);
    expect(delivered.filter((message) => message.subject.includes("Flaky mail"))).toHaveLength(1);
    const [stored] = await inA((tx) =>
      tx.select().from(apiTokens).where(eq(apiTokens.id, created.view.id)),
    );
    expect(stored?.expiryNotifiedAt).toEqual(clock);
  });
});
