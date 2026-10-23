import {
  ForbiddenError,
  type ApiCredential,
  type PolicyAction,
  type UserActor,
} from "@cohory/authz";
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
import { approvalRequests, auditLog, users } from "@cohory/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAgentsService } from "../service";
import { ApprovalsError } from "./errors";
import {
  approvalTtlMs,
  createApprovalsService,
  maxPendingPerAgent,
  reauthWindowMs,
  type ApprovalNoticeInput,
  type ProposalInput,
} from "./service";

const probeRole = "cohory_approvals_rls_probe";
const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
const db = createDb(pool);
// expireDue spans every community, so a clock years in the past keeps it away from
// requests that suites running in parallel create with the real clock.
let clock = new Date("2020-01-06T10:00:00.000Z");
const now = () => clock;
const notices: ApprovalNoticeInput[] = [];
const noticeReads: { communityId: string; approvalId: string; userId: string }[] = [];
const agents = createAgentsService({ db, now });
const service = createApprovalsService({
  db,
  now,
  notify: async (notice) => {
    notices.push(notice);
  },
  markNoticeRead: async (read) => {
    noticeReads.push(read);
  },
});

let communityA: CommunityId;
let communityB: CommunityId;
let ownerId = "";
let adminId = "";
let moderatorId = "";
let ownerB = "";

const actions: Record<string, PolicyAction> = {
  removeMember: "membership.remove",
  exportMembersCsv: "export.members",
};
const requiredAction = (operationId: string): PolicyAction | null => actions[operationId] ?? null;

function user(userId: string): UserActor {
  return { kind: "user", userId, platformAdmin: false };
}

async function insertUser(name: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ name, email: `approvals-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!row) throw new Error("no user");
  return row.id;
}

async function newAgent(
  communityId: CommunityId,
  owner: string,
): Promise<{ credential: ApiCredential; agentId: string }> {
  const agent = await agents.createAgent(user(owner), communityId, {
    name: `Helper ${newId().slice(-4)}`,
    scopes: ["proposals:write", "members:moderate"],
  });
  const issued = await agents.issueAgentToken(user(owner), communityId, agent.id, { name: "Key" });
  return {
    agentId: agent.id,
    credential: {
      type: "agent",
      tokenId: issued.view.id,
      agentId: agent.id,
      communityId,
      scopes: ["proposals:write", "members:moderate"],
      via: "api",
    },
  };
}

function proposal(operationId = "removeMember"): ProposalInput {
  return {
    operationId,
    method: "POST",
    path: `/api/v1/communities/x/manage/people/${newId()}/remove`,
    category: "removal",
    input: { params: { slug: "x" }, query: {}, body: null },
    summary: "remove Sam Lee from the community",
    diff: [{ label: "Membership", before: "Active member", after: "Removed" }],
  };
}

const fresh = () => ({ signedInAt: new Date(clock.getTime() - 60_000), requiredAction });

async function auditFor(communityId: string, approvalId: string) {
  return db.transaction(async (tx) => {
    await setRlsValue(tx, "community_id", communityId);
    return tx
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.communityId, communityId), eq(auditLog.target, approvalId)))
      .orderBy(auditLog.createdAt);
  });
}

async function asProbe<T>(communityId: string | null, fn: (tx: Transaction) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local role ${probeRole}`));
    if (communityId) {
      await setRlsValue(tx, "community_id", communityId);
    }
    return fn(tx);
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
    grant select, insert, update, delete on approval_requests to ${probeRole};
  `),
  );
  const suffix = newId().slice(-12);
  communityA = (
    await createCommunity(db, { slug: communitySlugSchema.parse(`appr-a-${suffix}`), name: "A" })
  ).id;
  communityB = (
    await createCommunity(db, { slug: communitySlugSchema.parse(`appr-b-${suffix}`), name: "B" })
  ).id;
  ownerId = await insertUser("Owner");
  adminId = await insertUser("Admin");
  moderatorId = await insertUser("Moderator");
  ownerB = await insertUser("Owner B");
  const a = withCommunity(db, communityA);
  await addMembership(a, { userId: ownerId, role: "owner", status: "active" });
  await addMembership(a, { userId: adminId, role: "admin", status: "active" });
  await addMembership(a, { userId: moderatorId, role: "moderator", status: "active" });
  await addMembership(withCommunity(db, communityB), {
    userId: ownerB,
    role: "owner",
    status: "active",
  });
});

afterAll(async () => {
  await pool.end();
});

describe("proposing", () => {
  it("stores a pending request, audits it as the agent, and notifies", async () => {
    const { credential, agentId } = await newAgent(communityA, adminId);

    const view = await service.propose(credential, adminId, proposal());

    expect(view).toMatchObject({
      state: "pending",
      operationId: "removeMember",
      category: "removal",
      agent: { id: agentId, status: "active" },
      owner: { id: adminId, name: "Admin" },
    });
    expect(view.expiresAt.getTime() - view.createdAt.getTime()).toBe(approvalTtlMs);
    const rows = await auditFor(communityA, view.id);
    expect(rows.map((row) => row.action)).toEqual(["approval.requested"]);
    expect(rows[0]?.actorId).toBe(adminId);
    expect(rows[0]?.metadata).toMatchObject({ agentId, ownerUserId: adminId });
    expect(notices.at(-1)).toMatchObject({
      approvalId: view.id,
      ownerUserId: adminId,
      detail: expect.stringContaining("asks to remove Sam Lee"),
    });
  });

  it("refuses the 21st pending request of one agent", async () => {
    const { credential } = await newAgent(communityA, ownerId);
    for (let index = 0; index < maxPendingPerAgent; index += 1) {
      await service.propose(credential, ownerId, proposal());
    }

    await expect(service.propose(credential, ownerId, proposal())).rejects.toMatchObject({
      code: "limit_reached",
    });
    const other = await newAgent(communityA, ownerId);
    await expect(service.propose(other.credential, ownerId, proposal())).resolves.toBeDefined();
  });

  it("refuses a personal token", async () => {
    const { credential } = await newAgent(communityA, ownerId);
    await expect(
      service.propose({ ...credential, type: "user", agentId: null }, ownerId, proposal()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("approving", () => {
  it("claims once, then finishing records approval and execution as the human", async () => {
    const { credential, agentId } = await newAgent(communityA, adminId);
    const { id } = await service.propose(credential, adminId, proposal());

    const [first, second] = await Promise.all([
      service.claim(user(ownerId), communityA, id, fresh()),
      service.claim(user(ownerId), communityA, id, fresh()),
    ]);
    const claims = [first, second].filter((outcome) => outcome.kind === "claimed");
    expect(claims).toHaveLength(1);
    const claimed = claims[0];
    if (claimed?.kind !== "claimed") throw new Error("not claimed");
    expect(claimed.request.approverId).toBe(ownerId);

    const done = await service.finish(claimed.request, { kind: "executed", result: { ok: true } });
    expect(done).toMatchObject({ state: "executed", decidedBy: { id: ownerId } });
    const again = await service.claim(user(ownerId), communityA, id, fresh());
    expect(again).toMatchObject({ kind: "decided", view: { state: "executed" } });

    const rows = await auditFor(communityA, id);
    expect(rows.map((row) => row.action)).toEqual([
      "approval.requested",
      "approval.approved",
      "approval.executed",
    ]);
    expect(rows[1]).toMatchObject({ actorId: ownerId, actorType: "user", via: "web", agentId });
    expect(rows[2]).toMatchObject({ actorId: ownerId, actorType: "user", tokenId: null });
    expect(rows[2]?.metadata).toMatchObject({ agentId, ownerUserId: adminId });
    expect(noticeReads).toContainEqual({
      communityId: communityA,
      approvalId: id,
      userId: ownerId,
    });
  });

  it("puts the request back when the executor refuses the approver", async () => {
    const { credential } = await newAgent(communityA, adminId);
    const { id } = await service.propose(credential, adminId, proposal());
    const outcome = await service.claim(user(adminId), communityA, id, fresh());
    if (outcome.kind !== "claimed") throw new Error("not claimed");

    const view = await service.finish(outcome.request, { kind: "released" });

    expect(view).toMatchObject({ state: "pending", decidedBy: null });
    expect((await auditFor(communityA, id)).map((row) => row.action)).toEqual([
      "approval.requested",
    ]);
  });

  it("refuses people who cannot decide, agents, and roles that could never do the action", async () => {
    const { credential } = await newAgent(communityA, adminId);
    const { id } = await service.propose(credential, adminId, proposal());
    const exportRequest = await service.propose(credential, adminId, proposal("exportMembersCsv"));

    await expect(service.claim(user(moderatorId), communityA, id, fresh())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      service.claim({ ...user(ownerId), credential }, communityA, id, fresh()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.claim(user(adminId), communityA, exportRequest.id, fresh()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.claim(user(ownerB), communityA, id, fresh())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await service.get(user(ownerId), communityA, id)).state).toBe("pending");
  });

  it("asks for a fresh sign in older than ten minutes", async () => {
    const { credential } = await newAgent(communityA, adminId);
    const { id } = await service.propose(credential, adminId, proposal());

    await expect(
      service.claim(user(ownerId), communityA, id, {
        signedInAt: new Date(clock.getTime() - reauthWindowMs - 1),
        requiredAction,
      }),
    ).rejects.toMatchObject({ code: "reauth_required" });
    await expect(
      service.claim(user(ownerId), communityA, id, { signedInAt: null, requiredAction }),
    ).rejects.toMatchObject({ code: "reauth_required" });
  });

  it("rejects instead of running when the agent was revoked", async () => {
    const { credential, agentId } = await newAgent(communityA, adminId);
    const { id } = await service.propose(credential, adminId, proposal());
    await agents.revokeAgent(user(ownerId), communityA, agentId);

    await expect(service.claim(user(ownerId), communityA, id, fresh())).rejects.toMatchObject({
      code: "agent_inactive",
    });
    expect(await service.get(user(ownerId), communityA, id)).toMatchObject({
      state: "rejected",
      errorCode: "agent_inactive",
    });
  });

  it("still lets a human approve after the agent's owner was demoted", async () => {
    const demoted = await insertUser("Demoted");
    await addMembership(withCommunity(db, communityA), {
      userId: demoted,
      role: "admin",
      status: "active",
    });
    const { credential } = await newAgent(communityA, demoted);
    const { id } = await service.propose(credential, demoted, proposal());
    await db.transaction(async (tx) => {
      await setRlsValue(tx, "community_id", communityA);
      await tx.execute(
        sql`update memberships set role = 'member' where community_id = ${communityA} and user_id = ${demoted}`,
      );
    });

    const outcome = await service.claim(user(ownerId), communityA, id, fresh());
    expect(outcome.kind).toBe("claimed");
  });
});

describe("rejecting and expiring", () => {
  it("records a rejection note once and keeps the request from running", async () => {
    const { credential } = await newAgent(communityA, adminId);
    const { id } = await service.propose(credential, adminId, proposal());

    const view = await service.reject(user(adminId), communityA, id, "  Not this one  ");
    const twice = await service.reject(user(ownerId), communityA, id, "again");

    expect(view).toMatchObject({ state: "rejected", decisionNote: "Not this one" });
    expect(twice.decidedBy?.id).toBe(adminId);
    expect(await service.claim(user(ownerId), communityA, id, fresh())).toMatchObject({
      kind: "decided",
    });
    const trail = await auditFor(communityA, id);
    expect(trail.map((row) => row.action)).toEqual(["approval.requested", "approval.rejected"]);
    expect(trail[1]).toMatchObject({ actorId: adminId, actorType: "user", via: "web" });
    expect(noticeReads).toContainEqual({
      communityId: communityA,
      approvalId: id,
      userId: adminId,
    });
  });

  it("still saves the decision when clearing the notice fails", async () => {
    const failing = createApprovalsService({
      db,
      now,
      markNoticeRead: async () => {
        throw new Error("notifications down");
      },
      logError: () => undefined,
    });
    const { credential } = await newAgent(communityA, adminId);
    const { id } = await failing.propose(credential, adminId, proposal());

    await expect(failing.reject(user(ownerId), communityA, id, null)).resolves.toMatchObject({
      state: "rejected",
      decidedBy: { id: ownerId },
    });
  });

  it("expires after 72 hours through the job and refuses a late approval", async () => {
    const { credential } = await newAgent(communityA, adminId);
    const { id } = await service.propose(credential, adminId, proposal());
    const late = await service.propose(credential, adminId, proposal());
    const start = clock;
    clock = new Date(start.getTime() + approvalTtlMs + 1000);
    try {
      const result = await service.expireDue();
      expect(result.expired).toBeGreaterThanOrEqual(2);
      expect((await service.get(user(ownerId), communityA, id)).state).toBe("expired");
      await expect(
        service.claim(user(ownerId), communityA, late.id, fresh()),
      ).resolves.toMatchObject({ kind: "decided", view: { state: "expired" } });
      expect((await auditFor(communityA, id)).map((row) => row.action)).toEqual([
        "approval.requested",
        "approval.expired",
      ]);
    } finally {
      clock = start;
    }
  });
});

describe("reading", () => {
  it("shows an agent only its own requests and hides other communities", async () => {
    const first = await newAgent(communityA, adminId);
    const second = await newAgent(communityA, adminId);
    const mine = await service.propose(first.credential, adminId, proposal());
    const theirs = await service.propose(second.credential, adminId, proposal());
    const firstActor = { ...user(adminId), credential: first.credential };

    expect((await service.get(firstActor, communityA, mine.id)).id).toBe(mine.id);
    await expect(service.get(firstActor, communityA, theirs.id)).rejects.toBeInstanceOf(
      ApprovalsError,
    );
    const listed = await service.listForActor(firstActor, communityA);
    expect(listed.every((view) => view.agent.id === first.agentId)).toBe(true);
    await expect(service.get(user(ownerB), communityB, mine.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(service.list(user(moderatorId), communityA, "pending")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await service.pendingCount(user(ownerId), communityA)).toBeGreaterThan(0);
    expect(await service.pendingCount(user(ownerB), communityB)).toBe(0);
  });

  it("hands out an approved download once to the requesting agent", async () => {
    const { credential } = await newAgent(communityA, ownerId);
    const other = await newAgent(communityA, ownerId);
    const { id } = await service.propose(credential, ownerId, proposal("exportMembersCsv"));
    const outcome = await service.claim(user(ownerId), communityA, id, fresh());
    if (outcome.kind !== "claimed") throw new Error("not claimed");
    await service.finish(outcome.request, { kind: "executed", result: { download: true } });

    await expect(service.claimDownload(other.credential, id)).rejects.toMatchObject({
      code: "download_unavailable",
    });
    const claim = await service.claimDownload(credential, id);
    expect(claim.approverId).toBe(ownerId);
    await expect(service.claimDownload(credential, id)).rejects.toMatchObject({
      code: "download_unavailable",
    });
    await service.releaseDownload(claim);
    await expect(service.claimDownload(credential, id)).resolves.toBeDefined();
  });
});

describe("row level security on approval_requests", () => {
  it("is enabled and forced", async () => {
    const result = await db.execute<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'approval_requests'`,
    );
    expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("shows nothing without a community and only that community's rows with one", async () => {
    const { credential } = await newAgent(communityB, ownerB);
    await service.propose({ ...credential }, ownerB, proposal());

    expect(await asProbe(null, (tx) => tx.select().from(approvalRequests))).toEqual([]);
    const rows = await asProbe(communityB, (tx) => tx.select().from(approvalRequests));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.communityId === communityB)).toBe(true);
  });
});
