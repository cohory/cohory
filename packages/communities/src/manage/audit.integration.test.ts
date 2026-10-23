import { ForbiddenError } from "@cohory/authz";
import { newId } from "@cohory/db";
import { agentIdentities, auditLog } from "@cohory/db/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CommunityValidationError } from "../errors";
import {
  insertCast,
  openManageHarness,
  type Cast,
  type ManageHarness,
} from "../test/manage-fixtures";

let h: ManageHarness;

beforeAll(async () => {
  h = await openManageHarness();
});

afterAll(async () => {
  await h.close();
});

async function seed(cast: Cast, entries: { action: string; at: string; target?: string }[]) {
  await h.admin.insert(auditLog).values(
    entries.map((entry) => ({
      communityId: cast.communityId,
      actorId: cast.owner.userId,
      action: entry.action,
      target: entry.target ?? null,
      metadata: { note: true },
      createdAt: new Date(entry.at),
    })),
  );
}

describe("audit log screen", () => {
  it("shows and filters agent and API token entries with the owning human", async () => {
    const cast = await insertCast(h.admin);
    const agentId = newId();
    const tokenId = newId();
    await h.admin.insert(agentIdentities).values({
      id: agentId,
      communityId: cast.communityId,
      ownerId: cast.owner.userId,
      name: "Drafter",
      scopes: ["posts:write"],
      createdBy: cast.owner.userId,
    });
    await h.admin.insert(auditLog).values([
      {
        communityId: cast.communityId,
        actorId: cast.owner.userId,
        actorType: "agent",
        via: "api",
        tokenId,
        agentId,
        action: "api.create_post",
        target: "/api/v1/communities/x/posts",
        createdAt: new Date("2026-10-05T10:00:00Z"),
      },
      {
        communityId: cast.communityId,
        actorId: cast.owner.userId,
        actorType: "user",
        via: "web",
        action: "settings.updated",
        target: null,
        createdAt: new Date("2026-10-04T10:00:00Z"),
      },
    ]);

    const agents = await h.service.listAuditLog(cast.owner, cast.communityId, {
      actorType: "agent",
    });
    expect(agents.data).toHaveLength(1);
    expect(agents.data[0]).toMatchObject({
      actor: { id: cast.owner.userId, name: "Owner" },
      actorType: "agent",
      via: "api",
      tokenId,
      agent: { id: agentId, name: "Drafter" },
    });
    const viaWeb = await h.service.listAuditLog(cast.owner, cast.communityId, { via: "web" });
    expect(viaWeb.data.map((entry) => entry.action)).toEqual(["settings.updated"]);
    const byAgent = await h.service.listAuditLog(cast.owner, cast.communityId, { agentId });
    expect(byAgent.data.map((entry) => entry.action)).toEqual(["api.create_post"]);

    const csv = await h.service.exportAuditLogCsv(cast.owner, cast.communityId, {
      actorType: "agent",
    });
    expect(csv.body).toContain(`agent,api,${tokenId},${agentId},Drafter,api.create_post`);
    await expect(
      h.service.listAuditLog(cast.owner, cast.communityId, { via: "fax" as "web" }),
    ).rejects.toBeInstanceOf(CommunityValidationError);
  });

  it("filters to one token's entries", async () => {
    const cast = await insertCast(h.admin);
    const tokenId = newId();
    await h.admin.insert(auditLog).values([
      {
        communityId: cast.communityId,
        actorId: cast.owner.userId,
        actorType: "user",
        via: "api",
        tokenId,
        action: "api.create_post",
        createdAt: new Date("2026-10-05T10:00:00Z"),
      },
      {
        communityId: cast.communityId,
        actorId: cast.owner.userId,
        actorType: "user",
        via: "api",
        tokenId: newId(),
        action: "api.delete_post",
        createdAt: new Date("2026-10-06T10:00:00Z"),
      },
    ]);

    const page = await h.service.listAuditLog(cast.owner, cast.communityId, { tokenId });
    expect(page.data.map((entry) => entry.action)).toEqual(["api.create_post"]);
  });

  it("leaves out excluded actions in the query, so the limit counts only the rest", async () => {
    const cast = await insertCast(h.admin);
    const agentId = newId();
    await h.admin.insert(agentIdentities).values({
      id: agentId,
      communityId: cast.communityId,
      ownerId: cast.admin.userId,
      name: "Busy",
      scopes: ["posts:write"],
      createdBy: cast.admin.userId,
    });
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 5, 10, minute));
    await h.admin.insert(auditLog).values([
      {
        communityId: cast.communityId,
        actorId: cast.admin.userId,
        actorType: "agent",
        via: "api",
        tokenId: newId(),
        agentId,
        action: "api.create_post",
        createdAt: at(0),
      },
      {
        communityId: cast.communityId,
        actorId: cast.owner.userId,
        actorType: "user",
        via: "web",
        agentId,
        action: "member.removed",
        createdAt: at(1),
      },
      ...[2, 3, 4, 5].map((minute) => ({
        communityId: cast.communityId,
        actorId: cast.admin.userId,
        actorType: "agent" as const,
        via: "api" as const,
        tokenId: newId(),
        agentId,
        action: "approval.requested",
        createdAt: at(minute),
      })),
    ]);

    const page = await h.service.listAuditLog(cast.owner, cast.communityId, {
      agentId,
      excludeActions: ["approval.requested"],
      limit: 3,
    });
    expect(page.data.map((entry) => entry.action)).toEqual(["member.removed", "api.create_post"]);
  });

  it("lists entries newest first with actor and target names and pages with a cursor", async () => {
    const cast = await insertCast(h.admin);
    await seed(cast, [
      { action: "member.banned", at: "2026-10-01T10:00:00Z", target: cast.member.userId },
      { action: "settings.updated", at: "2026-10-02T10:00:00Z" },
      { action: "invite.created", at: "2026-10-03T10:00:00Z" },
    ]);

    const first = await h.service.listAuditLog(cast.admin, cast.communityId, { limit: 2 });
    expect(first.data.map((entry) => entry.action)).toEqual(["invite.created", "settings.updated"]);
    expect(first.data[0]?.actor).toEqual({ id: cast.owner.userId, name: "Owner" });
    expect(first.actions).toEqual(["invite.created", "member.banned", "settings.updated"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await h.service.listAuditLog(cast.admin, cast.communityId, {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.data).toHaveLength(1);
    expect(second.data[0]).toMatchObject({ action: "member.banned", targetName: "Member" });
    expect(second.nextCursor).toBeNull();
  });

  it("filters by action and by date range, inclusive of the end day", async () => {
    const cast = await insertCast(h.admin);
    await seed(cast, [
      { action: "member.banned", at: "2026-10-01T10:00:00Z" },
      { action: "member.banned", at: "2026-10-05T23:30:00Z" },
      { action: "settings.updated", at: "2026-10-05T09:00:00Z" },
      { action: "member.banned", at: "2026-10-09T10:00:00Z" },
    ]);

    const page = await h.service.listAuditLog(cast.owner, cast.communityId, {
      action: "member.banned",
      from: "2026-10-02",
      to: "2026-10-05",
    });
    expect(page.data.map((entry) => entry.createdAt.toISOString())).toEqual([
      "2026-10-05T23:30:00.000Z",
    ]);
    await expect(
      h.service.listAuditLog(cast.owner, cast.communityId, {
        from: "2026-10-05",
        to: "2026-10-01",
      }),
    ).rejects.toBeInstanceOf(CommunityValidationError);
    await expect(
      h.service.listAuditLog(cast.owner, cast.communityId, { cursor: "nope" }),
    ).rejects.toBeInstanceOf(CommunityValidationError);
  });

  it("is for admins and the owner only", async () => {
    const cast = await insertCast(h.admin);
    for (const actor of [cast.moderator, cast.member, cast.outsider]) {
      await expect(h.service.listAuditLog(actor, cast.communityId)).rejects.toThrow();
    }
    await expect(h.service.listAuditLog(cast.moderator, cast.communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("never shows another community's entries", async () => {
    const a = await insertCast(h.admin);
    const b = await insertCast(h.admin);
    await seed(a, [{ action: "member.banned", at: "2026-10-01T10:00:00Z" }]);

    expect((await h.service.listAuditLog(b.owner, b.communityId)).data).toEqual([]);
    await expect(h.service.listAuditLog(b.owner, a.communityId)).rejects.toThrow();
  });

  it("exports CSV for the owner only and records the export", async () => {
    const cast = await insertCast(h.admin);
    await seed(cast, [{ action: "=cmd", at: "2026-10-01T10:00:00Z", target: cast.member.userId }]);

    const csv = await h.service.exportAuditLogCsv(cast.owner, cast.communityId);
    expect(csv.body.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.body.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "created_at,actor,actor_id,actor_type,via,token_id,agent_id,agent_name,action,target,target_name,metadata",
    );
    expect(lines[1]).toContain("'=cmd");
    expect(lines[1]).toContain("Member");
    expect(csv.filename).toMatch(new RegExp(`^${cast.slug}-audit-log-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
    expect(csv.truncated).toBe(false);

    await expect(h.service.exportAuditLogCsv(cast.admin, cast.communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const after = await h.service.listAuditLog(cast.owner, cast.communityId);
    expect(after.data[0]?.action).toBe("export.audit_log_csv");
  });
});

describe("own agent and token activity", () => {
  async function seedCredentialWork(cast: Cast) {
    const mine = newId();
    const theirs = newId();
    const myToken = newId();
    await h.admin.insert(agentIdentities).values([
      {
        id: mine,
        communityId: cast.communityId,
        ownerId: cast.member.userId,
        name: "Helper",
        scopes: ["posts:write"],
        createdBy: cast.member.userId,
      },
      {
        id: theirs,
        communityId: cast.communityId,
        ownerId: cast.admin.userId,
        name: "Ops",
        scopes: ["posts:write"],
        createdBy: cast.admin.userId,
      },
    ]);
    await h.admin.insert(auditLog).values([
      {
        communityId: cast.communityId,
        actorId: cast.member.userId,
        actorType: "agent",
        via: "mcp",
        tokenId: newId(),
        agentId: mine,
        action: "api.create_post",
        createdAt: new Date("2026-10-05T10:00:00Z"),
      },
      {
        communityId: cast.communityId,
        actorId: cast.member.userId,
        actorType: "user",
        via: "api",
        tokenId: myToken,
        action: "api.create_comment",
        createdAt: new Date("2026-10-06T10:00:00Z"),
      },
      {
        communityId: cast.communityId,
        actorId: cast.admin.userId,
        actorType: "agent",
        via: "api",
        tokenId: newId(),
        agentId: theirs,
        action: "api.delete_post",
        createdAt: new Date("2026-10-07T10:00:00Z"),
      },
      {
        communityId: cast.communityId,
        actorId: cast.member.userId,
        actorType: "user",
        via: "web",
        action: "post.created",
        createdAt: new Date("2026-10-08T10:00:00Z"),
      },
      {
        communityId: cast.communityId,
        actorId: cast.admin.userId,
        actorType: "user",
        via: "web",
        agentId: mine,
        action: "approval.rejected",
        createdAt: new Date("2026-10-09T10:00:00Z"),
      },
    ]);
    return { mine, theirs, myToken };
  }

  it("shows a member only what their own agents and tokens did", async () => {
    const cast = await insertCast(h.admin);
    const { mine, theirs, myToken } = await seedCredentialWork(cast);

    const all = await h.service.listOwnActivity(cast.member, cast.communityId);
    expect(all.data.map((entry) => entry.action)).toEqual([
      "api.create_comment",
      "api.create_post",
    ]);
    const byAgent = await h.service.listOwnActivity(cast.member, cast.communityId, {
      agentId: mine,
    });
    expect(byAgent.data.map((entry) => entry.agent?.name)).toEqual(["Helper"]);
    const byToken = await h.service.listOwnActivity(cast.member, cast.communityId, {
      tokenId: myToken,
    });
    expect(byToken.data.map((entry) => entry.action)).toEqual(["api.create_comment"]);
    const otherAgent = await h.service.listOwnActivity(cast.member, cast.communityId, {
      agentId: theirs,
    });
    expect(otherAgent.data).toEqual([]);
  });

  it("refuses people who are not members and other communities", async () => {
    const cast = await insertCast(h.admin);
    const other = await insertCast(h.admin);
    await seedCredentialWork(cast);

    await expect(h.service.listOwnActivity(cast.outsider, cast.communityId)).rejects.toThrow();
    await expect(h.service.listOwnActivity(other.member, cast.communityId)).rejects.toThrow();
    expect((await h.service.listOwnActivity(other.member, other.communityId)).data).toEqual([]);
  });

  it("does not answer to an API token", async () => {
    const cast = await insertCast(h.admin);
    await seedCredentialWork(cast);
    const viaToken = {
      ...cast.member,
      credential: {
        type: "user" as const,
        tokenId: newId(),
        communityId: cast.communityId,
        agentId: null,
        scopes: ["settings:read" as const],
        via: "api" as const,
      },
    };
    await expect(h.service.listOwnActivity(viaToken, cast.communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
