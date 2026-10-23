import { createAgentsService } from "@cohory/agents";
import { ForbiddenError, type Actor, type Scope } from "@cohory/authz";
import {
  addMembership,
  communitySlugSchema,
  createCommunity,
  createDb,
  createPool,
  getMembership,
  newId,
  parseAdminDatabaseEnv,
  setMembershipStatus,
  withCommunity,
  type CommunityId,
} from "@cohory/db";
import {
  agentIdentities,
  agentSubmissions,
  auditLog,
  courseDelegations,
  courses,
  notifications,
  users,
} from "@cohory/db/schema";
import { createAgentAccessNotifier } from "@cohory/notifications";
import { resolveMembershipAccess, type MembershipAccess } from "@cohory/entitlements/access";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createEntitlementsService,
  DelegationRequiredError,
  EntitlementsError,
} from "@cohory/entitlements";

const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
const db = createDb(pool);
const dayMs = 24 * 60 * 60 * 1000;

// The sweep is global, so this clock stays far behind real time: integration suites of other
// packages share the database, and their live delegations must not look expired here.
let clock = new Date("2025-01-15T12:00:00Z");
const now = () => clock;

interface SubscriptionFixture {
  providerStatus: string;
  accessState: "none" | "granted" | "grace" | "revoked";
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  connectionClosedAt?: Date | null;
}

const subscriptions = new Map<string, SubscriptionFixture>();
const comps = new Map<string, { expiresAt: Date | null }>();

async function membershipAccess(communityId: string, userId: string): Promise<MembershipAccess> {
  const membership = await getMembership(withCommunity(db, communityId as CommunityId), userId);
  return resolveMembershipAccess({
    paidPlanActive: true,
    membership: membership ? { role: membership.role, status: membership.status } : null,
    subscription: subscriptions.get(`${communityId}:${userId}`) ?? null,
    comp: comps.get(`${communityId}:${userId}`) ?? null,
    now: clock,
  });
}

const agentsService = createAgentsService({ db, now });
const service = createEntitlementsService({
  db,
  now,
  agents: {
    find: (communityId, agentId) => agentsService.findAgent(communityId, agentId),
    list: (communityId, filter) => agentsService.agentSummaries(communityId, filter),
  },
  membershipAccess,
  notify: createAgentAccessNotifier({ db, now }),
});

interface World {
  communityId: CommunityId;
  ownerId: string;
  memberId: string;
  courseId: string;
  otherCourseId: string;
  agentId: string;
}

function human(userId: string): Actor {
  return { kind: "user", userId, platformAdmin: false };
}

function agentActor(
  world: Pick<World, "communityId">,
  ownerId: string,
  agentId: string,
  scopes: Scope[] = ["courses:read"],
): Actor {
  return {
    kind: "user",
    userId: ownerId,
    platformAdmin: false,
    credential: {
      type: "agent",
      tokenId: newId(),
      agentId,
      communityId: world.communityId,
      scopes,
      via: "api",
    },
  };
}

async function insertUser(name: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ name, email: `${name.toLowerCase()}-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!row) throw new Error("no user");
  return row.id;
}

async function insertCourse(communityId: CommunityId, title: string): Promise<string> {
  const id = newId();
  await db.insert(courses).values({
    id,
    communityId,
    slug: `c-${id.slice(-12)}`,
    title,
    status: "published",
    position: 0,
  });
  return id;
}

async function insertAgent(
  communityId: CommunityId,
  ownerId: string,
  name = "Helper",
): Promise<string> {
  const id = newId();
  await db.insert(agentIdentities).values({
    id,
    communityId,
    ownerId,
    name,
    scopes: ["courses:read"],
    createdBy: ownerId,
  });
  return id;
}

async function makeWorld(): Promise<World> {
  const suffix = newId().slice(-12);
  const community = await createCommunity(db, {
    slug: communitySlugSchema.parse(`ent-${suffix}`),
    name: "Entitlements",
  });
  const communityId = community.id;
  const ownerId = await insertUser("Owner");
  const memberId = await insertUser("Member");
  await addMembership(withCommunity(db, communityId), {
    userId: ownerId,
    role: "owner",
    status: "active",
  });
  await addMembership(withCommunity(db, communityId), {
    userId: memberId,
    role: "member",
    status: "active",
  });
  subscriptions.set(`${communityId}:${memberId}`, {
    providerStatus: "active",
    accessState: "granted",
    currentPeriodEnd: new Date(clock.getTime() + 20 * dayMs),
    cancelAtPeriodEnd: false,
  });
  const courseId = await insertCourse(communityId, "Agents 101");
  const otherCourseId = await insertCourse(communityId, "Other");
  const agentId = await insertAgent(communityId, memberId);
  await service.updateCourseAgentSettings(human(ownerId), communityId, courseId, {
    allowAgentAccess: true,
    licenseId: "personal_agents",
  });
  return { communityId, ownerId, memberId, courseId, otherCourseId, agentId };
}

async function delegate(world: World) {
  return service.createDelegation(human(world.memberId), world.communityId, {
    courseId: world.courseId,
    agentId: world.agentId,
  });
}

async function accessOf(world: World, courseId = world.courseId) {
  return service.agentCourseAccess(
    agentActor(world, world.memberId, world.agentId),
    world.communityId,
    courseId,
  );
}

async function auditActions(world: World): Promise<string[]> {
  const rows = await db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.communityId, world.communityId));
  return rows.map((row) => row.action);
}

beforeEach(() => {
  clock = new Date("2025-01-15T12:00:00Z");
});

afterAll(async () => {
  await pool.end();
});

describe("delegated course access", () => {
  let world: World;

  beforeAll(async () => {
    world = await makeWorld();
  });

  it("answers not_agent for people and personal tokens", async () => {
    expect(
      await service.agentCourseAccess(human(world.memberId), world.communityId, world.courseId),
    ).toEqual({ kind: "not_agent" });
  });

  it("denies an agent before its human delegates", async () => {
    const fresh = await makeWorld();
    expect(await accessOf(fresh)).toEqual({ kind: "denied", reason: "no_delegation" });
    await expect(
      service.assertAgentCourseAccess(
        agentActor(fresh, fresh.memberId, fresh.agentId),
        fresh.communityId,
        fresh.courseId,
      ),
    ).rejects.toBeInstanceOf(DelegationRequiredError);
  });

  it("grants read access through an active delegation for 30 days", async () => {
    const created = await delegate(world);
    expect(created.state).toEqual({ kind: "active" });
    expect(created.expiresAt.getTime() - clock.getTime()).toBe(30 * dayMs);
    const access = await accessOf(world);
    expect(access).toMatchObject({
      kind: "delegated",
      agentId: world.agentId,
      humanUserId: world.memberId,
      delegationId: created.id,
      license: { id: "personal_agents", label: "Personal use by the buyer's agents only" },
    });
    expect(await auditActions(world)).toContain("delegation.created");
  });

  it("refuses a second live delegation of the same course to the same agent", async () => {
    await expect(delegate(world)).rejects.toMatchObject({ code: "already_delegated" });
  });

  it("does not reach other courses", async () => {
    expect(await accessOf(world, world.otherCourseId)).toEqual({
      kind: "denied",
      reason: "agent_access_off",
    });
    const ids = await service.delegatedCourseIds(
      agentActor(world, world.memberId, world.agentId),
      world.communityId,
    );
    expect([...(ids ?? [])]).toEqual([world.courseId]);
  });

  it("denies a token bound to another community", async () => {
    const other = await makeWorld();
    const actor = agentActor(other, world.memberId, world.agentId);
    expect(await service.agentCourseAccess(actor, world.communityId, world.courseId)).toEqual({
      kind: "denied",
      reason: "wrong_community",
    });
    await expect(
      service.createDelegation(human(other.memberId), other.communityId, {
        courseId: world.courseId,
        agentId: other.agentId,
      }),
    ).rejects.toMatchObject({ code: "agent_access_off" });
  });

  it("refuses re delegation by an agent", async () => {
    await expect(
      service.createDelegation(
        agentActor(world, world.memberId, world.agentId),
        world.communityId,
        { courseId: world.courseId, agentId: world.agentId },
      ),
    ).rejects.toMatchObject({ code: "redelegation_refused" });
    const personal: Actor = {
      kind: "user",
      userId: world.memberId,
      platformAdmin: false,
      credential: {
        type: "user",
        tokenId: newId(),
        agentId: null,
        communityId: world.communityId,
        scopes: ["courses:read"],
        via: "api",
      },
    };
    await expect(
      service.createDelegation(personal, world.communityId, {
        courseId: world.courseId,
        agentId: world.agentId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses delegating to someone else's agent", async () => {
    const ownerAgent = await insertAgent(world.communityId, world.ownerId, "Owner bot");
    await expect(
      service.createDelegation(human(world.memberId), world.communityId, {
        courseId: world.courseId,
        agentId: ownerAgent,
      }),
    ).rejects.toMatchObject({ code: "agent_not_found" });
  });
});

describe("delegation ends with the human, the agent, or the creator", () => {
  it("keeps access while payment is past due and ends when the subscription ends", async () => {
    const world = await makeWorld();
    await delegate(world);
    const key = `${world.communityId}:${world.memberId}`;
    subscriptions.set(key, {
      providerStatus: "past_due",
      accessState: "grace",
      currentPeriodEnd: clock,
      cancelAtPeriodEnd: false,
    });
    expect((await accessOf(world)).kind).toBe("delegated");
    subscriptions.set(key, {
      providerStatus: "unpaid",
      accessState: "revoked",
      currentPeriodEnd: clock,
      cancelAtPeriodEnd: false,
    });
    await setMembershipStatus(withCommunity(db, world.communityId), world.memberId, "removed");
    expect(await accessOf(world)).toEqual({ kind: "denied", reason: "human_access_ended" });
  });

  it("revokes course access after the period end once the creator disconnected", async () => {
    const world = await makeWorld();
    await delegate(world);
    const key = `${world.communityId}:${world.memberId}`;
    subscriptions.set(key, {
      providerStatus: "active",
      accessState: "granted",
      currentPeriodEnd: new Date(clock.getTime() + 2 * dayMs),
      cancelAtPeriodEnd: false,
      connectionClosedAt: clock,
    });
    expect((await accessOf(world)).kind).toBe("delegated");

    clock = new Date(clock.getTime() + 3 * dayMs);

    expect(await accessOf(world)).toEqual({ kind: "denied", reason: "human_access_ended" });
  });

  it("keeps access until a cancel at period end subscription ends", async () => {
    const world = await makeWorld();
    await delegate(world);
    const key = `${world.communityId}:${world.memberId}`;
    subscriptions.set(key, {
      providerStatus: "active",
      accessState: "granted",
      currentPeriodEnd: new Date(clock.getTime() + 2 * dayMs),
      cancelAtPeriodEnd: true,
    });
    expect((await accessOf(world)).kind).toBe("delegated");
    clock = new Date(clock.getTime() + 3 * dayMs);
    subscriptions.set(key, {
      providerStatus: "canceled",
      accessState: "revoked",
      currentPeriodEnd: new Date(clock.getTime() - dayMs),
      cancelAtPeriodEnd: true,
    });
    await setMembershipStatus(withCommunity(db, world.communityId), world.memberId, "removed");
    expect(await accessOf(world)).toEqual({ kind: "denied", reason: "human_access_ended" });
    const result = await service.sweepDelegations();
    expect(result.ended).toBeGreaterThanOrEqual(1);
    const [row] = await db
      .select()
      .from(courseDelegations)
      .where(eq(courseDelegations.communityId, world.communityId));
    expect(row?.revokedReason).toBe("access_ended");
    expect(await auditActions(world)).toContain("delegation.ended");
  });

  it("ends when the human removes the member", async () => {
    const world = await makeWorld();
    await delegate(world);
    await setMembershipStatus(withCommunity(db, world.communityId), world.memberId, "removed");
    subscriptions.delete(`${world.communityId}:${world.memberId}`);
    expect(await accessOf(world)).toEqual({ kind: "denied", reason: "human_access_ended" });
  });

  it("ends when the human revokes it, and renewal is refused afterwards", async () => {
    const world = await makeWorld();
    const created = await delegate(world);
    const revoked = await service.revokeDelegation(
      human(world.memberId),
      world.communityId,
      created.id,
    );
    expect(revoked.state).toEqual({ kind: "ended", reason: "revoked" });
    expect(await accessOf(world)).toEqual({ kind: "denied", reason: "revoked" });
    await expect(
      service.renewDelegation(human(world.memberId), world.communityId, created.id),
    ).rejects.toMatchObject({ code: "cannot_renew" });
    expect(await auditActions(world)).toContain("delegation.revoked");
    const again = await delegate(world);
    expect(again.state).toEqual({ kind: "active" });
  });

  it("expires after 30 days unless renewed, and notifies 3 days before", async () => {
    const world = await makeWorld();
    const created = await delegate(world);
    clock = new Date(clock.getTime() + 28 * dayMs);
    const swept = await service.sweepDelegations();
    expect(swept.noticesSent).toBeGreaterThanOrEqual(1);
    const notices = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.communityId, world.communityId),
          eq(notifications.userId, world.memberId),
        ),
      );
    expect(notices.map((n) => n.type)).toEqual(["agent_access"]);
    const renewed = await service.renewDelegation(
      human(world.memberId),
      world.communityId,
      created.id,
    );
    expect(renewed.renewedAt).toEqual(clock);
    expect(renewed.expiresAt.getTime() - clock.getTime()).toBe(30 * dayMs);
    expect(await auditActions(world)).toContain("delegation.renewed");
    clock = new Date(clock.getTime() + 31 * dayMs);
    expect(await accessOf(world)).toEqual({ kind: "denied", reason: "expired" });
    await service.sweepDelegations();
    const [row] = await db
      .select()
      .from(courseDelegations)
      .where(eq(courseDelegations.id, created.id));
    expect(row?.revokedReason).toBe("expired");
  });

  it("ends when the agent is suspended", async () => {
    const world = await makeWorld();
    await delegate(world);
    await db
      .update(agentIdentities)
      .set({ status: "suspended" })
      .where(eq(agentIdentities.id, world.agentId));
    expect(await accessOf(world)).toEqual({ kind: "denied", reason: "agent_inactive" });
  });

  it("ends when the creator turns agent access off", async () => {
    const world = await makeWorld();
    const created = await delegate(world);
    await service.updateCourseAgentSettings(
      human(world.ownerId),
      world.communityId,
      world.courseId,
      {
        allowAgentAccess: false,
        licenseId: "personal_agents",
      },
    );
    expect(await accessOf(world)).toEqual({ kind: "denied", reason: "agent_access_off" });
    const [mine] = await service.listMyDelegations(human(world.memberId), world.communityId);
    expect(mine?.id).toBe(created.id);
    expect(mine?.state).toEqual({ kind: "ended", reason: "agent_access_off" });
  });

  it("lets only managers change agent access and refuses agents", async () => {
    const world = await makeWorld();
    await expect(
      service.updateCourseAgentSettings(human(world.memberId), world.communityId, world.courseId, {
        allowAgentAccess: true,
        licenseId: "personal_agents",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.updateCourseAgentSettings(
        agentActor(world, world.ownerId, world.agentId),
        world.communityId,
        world.courseId,
        { allowAgentAccess: true, licenseId: "personal_agents" },
      ),
    ).rejects.toBeInstanceOf(EntitlementsError);
    await expect(
      service.updateCourseAgentSettings(human(world.ownerId), world.communityId, world.courseId, {
        allowAgentAccess: true,
        licenseId: "custom",
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("treats agents of owners and admins as staff without a delegation", async () => {
    const world = await makeWorld();
    const ownerAgent = await insertAgent(world.communityId, world.ownerId, "Owner bot");
    expect(
      await service.agentCourseAccess(
        agentActor(world, world.ownerId, ownerAgent),
        world.communityId,
        world.otherCourseId,
      ),
    ).toEqual({ kind: "staff", agentId: ownerAgent, humanUserId: world.ownerId });
  });
});

describe("agent submissions", () => {
  it("stores a self reported result attributed to agent, human, version and run", async () => {
    const world = await makeWorld();
    const delegation = await delegate(world);
    const actor = agentActor(world, world.memberId, world.agentId);
    const input = {
      courseId: world.courseId,
      lessonId: "lesson-1",
      taskId: "task-a",
      version: "1.0.0",
      runId: "run-1",
      payload: { passed: 3, failed: 1 },
    };
    const created = await service.submitAgentResult(actor, input);
    expect(created).toMatchObject({
      label: "self_reported",
      agent: { id: world.agentId, name: "Helper" },
      humanId: world.memberId,
      version: "1.0.0",
      runId: "run-1",
    });
    const [row] = await db
      .select()
      .from(agentSubmissions)
      .where(eq(agentSubmissions.id, created.id));
    expect(row?.delegationId).toBe(delegation.id);
    await expect(service.submitAgentResult(actor, input)).rejects.toMatchObject({
      code: "duplicate_submission",
    });
    await service.submitAgentResult(actor, { ...input, taskId: "task-b" });
    const mine = await service.listSubmissions(
      human(world.memberId),
      world.communityId,
      world.courseId,
    );
    expect(mine.map((s) => s.taskId).sort()).toEqual(["task-a", "task-b"]);
    expect(mine[0]?.payload).toBeDefined();
    const summary = await service.submissionSummary(
      human(world.ownerId),
      world.communityId,
      world.courseId,
    );
    expect(summary).toEqual([
      expect.objectContaining({ taskId: "task-a", submissions: 1, agents: 1, members: 1 }),
      expect.objectContaining({ taskId: "task-b", submissions: 1 }),
    ]);
    expect(Object.keys(summary[0] ?? {})).not.toContain("payload");
    await expect(
      service.submissionSummary(human(world.memberId), world.communityId, world.courseId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await auditActions(world)).toContain("submission.created");
  });

  it("refuses submissions without a delegation, from people, and over the size cap", async () => {
    const world = await makeWorld();
    const actor = agentActor(world, world.memberId, world.agentId);
    const input = {
      courseId: world.courseId,
      lessonId: "l",
      taskId: "t",
      version: "1",
      runId: "r",
      payload: {},
    };
    await expect(service.submitAgentResult(actor, input)).rejects.toBeInstanceOf(
      DelegationRequiredError,
    );
    await expect(service.submitAgentResult(human(world.memberId), input)).rejects.toMatchObject({
      code: "agents_only",
    });
    await delegate(world);
    await expect(
      service.submitAgentResult(actor, { ...input, payload: { blob: "x".repeat(70 * 1024) } }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("delegations do not depend on when the daily sweep runs", () => {
  function subscription(world: World, accessState: "granted" | "revoked") {
    subscriptions.set(`${world.communityId}:${world.memberId}`, {
      providerStatus: accessState === "granted" ? "active" : "canceled",
      accessState,
      currentPeriodEnd: new Date(clock.getTime() + 20 * dayMs),
      cancelAtPeriodEnd: false,
    });
  }

  async function lapse(world: World) {
    subscription(world, "revoked");
    await setMembershipStatus(withCommunity(db, world.communityId), world.memberId, "removed");
    expect(await accessOf(world)).toEqual({ kind: "denied", reason: "human_access_ended" });
  }

  async function payAgain(world: World) {
    clock = new Date(clock.getTime() + 60 * 60 * 1000);
    subscription(world, "granted");
    await setMembershipStatus(
      withCommunity(db, world.communityId),
      world.memberId,
      "active",
      clock,
    );
  }

  async function leaveAndReturn(world: World) {
    await lapse(world);
    await payAgain(world);
  }

  it("does not bring a delegation back when the membership returns before the sweep", async () => {
    const world = await makeWorld();
    const created = await delegate(world);
    await leaveAndReturn(world);
    expect(await accessOf(world)).toEqual({ kind: "denied", reason: "human_access_ended" });
    const [mine] = await service.listMyDelegations(human(world.memberId), world.communityId);
    expect(mine?.state).toEqual({ kind: "ended", reason: "access_ended" });
    await expect(
      service.renewDelegation(human(world.memberId), world.communityId, created.id),
    ).rejects.toMatchObject({ code: "cannot_renew" });
    const again = await delegate(world);
    expect(again.state).toEqual({ kind: "active" });
    expect((await accessOf(world)).kind).toBe("delegated");
    const [old] = await db
      .select()
      .from(courseDelegations)
      .where(eq(courseDelegations.id, created.id));
    expect(old?.revokedReason).toBe("access_ended");
  });

  it("gives the same answer when the sweep ran during the lapse", async () => {
    const world = await makeWorld();
    const created = await delegate(world);
    await lapse(world);
    await service.sweepDelegations();
    await payAgain(world);
    expect(await accessOf(world)).toEqual({ kind: "denied", reason: "human_access_ended" });
    const [row] = await db
      .select()
      .from(courseDelegations)
      .where(eq(courseDelegations.id, created.id));
    expect(row?.revokedReason).toBe("access_ended");
  });

  it("ends a delegation in the sweep when the member came back before it ran", async () => {
    const world = await makeWorld();
    const created = await delegate(world);
    await leaveAndReturn(world);
    await service.sweepDelegations();
    const [row] = await db
      .select()
      .from(courseDelegations)
      .where(eq(courseDelegations.id, created.id));
    expect(row?.revokedReason).toBe("access_ended");
  });

  it("pauses a delegation while the agent is paused and resumes it, whether or not the sweep ran", async () => {
    for (const sweep of [false, true]) {
      const world = await makeWorld();
      await delegate(world);
      await db
        .update(agentIdentities)
        .set({ status: "suspended" })
        .where(eq(agentIdentities.id, world.agentId));
      expect(await accessOf(world)).toEqual({ kind: "denied", reason: "agent_inactive" });
      if (sweep) await service.sweepDelegations();
      await db
        .update(agentIdentities)
        .set({ status: "active" })
        .where(eq(agentIdentities.id, world.agentId));
      expect((await accessOf(world)).kind, `sweep ${sweep}`).toBe("delegated");
    }
  });

  it("records the end of a paused agent's delegation when its person's access ended", async () => {
    const world = await makeWorld();
    const created = await delegate(world);
    await lapse(world);
    await db
      .update(agentIdentities)
      .set({ status: "suspended" })
      .where(eq(agentIdentities.id, world.agentId));
    await service.sweepDelegations();
    const [row] = await db
      .select()
      .from(courseDelegations)
      .where(eq(courseDelegations.id, created.id));
    expect(row?.revokedReason).toBe("access_ended");
  });

  it("ends a revoked agent's delegations for good", async () => {
    const world = await makeWorld();
    const created = await delegate(world);
    await db
      .update(agentIdentities)
      .set({ status: "revoked" })
      .where(eq(agentIdentities.id, world.agentId));
    await service.sweepDelegations();
    const [row] = await db
      .select()
      .from(courseDelegations)
      .where(eq(courseDelegations.id, created.id));
    expect(row?.revokedReason).toBe("agent_inactive");
  });

  it("follows free access: kept while the member stays, ended when the expiry job removes them", async () => {
    const world = await makeWorld();
    const key = `${world.communityId}:${world.memberId}`;
    subscriptions.delete(key);
    comps.set(key, { expiresAt: new Date(clock.getTime() + dayMs) });
    await delegate(world);
    expect((await accessOf(world)).kind).toBe("delegated");
    comps.delete(key);
    await setMembershipStatus(withCommunity(db, world.communityId), world.memberId, "removed");
    expect(await accessOf(world)).toEqual({ kind: "denied", reason: "human_access_ended" });
  });
});
