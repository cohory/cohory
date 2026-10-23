import { ForbiddenError, type Actor, type CommunityRole } from "@cohory/authz";
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
import { migrationLockKey } from "@cohory/db/migrations";
import { auditLog, contentReports, outbox, users } from "@cohory/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CommentNotFoundError, PostNotFoundError, PostValidationError } from "./errors";
import { createPostgresPostsRepository } from "./postgres-repository";
import { createPostsService } from "./service";

const probeRole = "cohory_reports_probe";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const adminPool = createPool(adminUrl);
const adminDb = createDb(adminPool);
const appUrl = new URL(adminUrl);
appUrl.searchParams.set("options", `-c role=${probeRole}`);
const appPool = createPool(appUrl.toString());
const appDb = createDb(appPool);

let clock = Date.UTC(2026, 3, 1);
const limited: string[] = [];
const service = createPostsService({
  repo: createPostgresPostsRepository(appDb),
  storage: {
    put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
    publicUrl: (key) => `/files/${key}`,
  },
  now: () => new Date((clock += 1000)),
  rateLimit: (rule, userId) => {
    limited.push(`${rule}:${userId}`);
  },
});

type UserActor = Actor & { kind: "user" };

async function newUser(name: string): Promise<UserActor> {
  const [row] = await adminDb
    .insert(users)
    .values({ name, email: `reports-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!row) {
    throw new Error("user insert returned no row");
  }
  return { kind: "user", userId: row.id, platformAdmin: false };
}

async function newCommunity(): Promise<CommunityId> {
  const community = await createCommunity(adminDb, {
    slug: communitySlugSchema.parse(`reports-${newId().slice(-12)}`),
    name: "Reports",
    privacy: "private",
  });
  return community.id;
}

async function join(communityId: CommunityId, role: CommunityRole, name: string = role) {
  const actor = await newUser(name);
  await addMembership(withCommunity(adminDb, communityId), {
    userId: actor.userId,
    role,
    status: "active",
    joinedAt: new Date(),
  });
  return actor;
}

function body(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

interface Cast {
  readonly communityId: CommunityId;
  readonly owner: UserActor;
  readonly admin: UserActor;
  readonly moderator: UserActor;
  readonly author: UserActor;
  readonly reporter: UserActor;
  readonly second: UserActor;
}

async function cast(): Promise<Cast> {
  const communityId = await newCommunity();
  return {
    communityId,
    owner: await join(communityId, "owner"),
    admin: await join(communityId, "admin"),
    moderator: await join(communityId, "moderator", "Mia Moderator"),
    author: await join(communityId, "member", "Ann Author"),
    reporter: await join(communityId, "member"),
    second: await join(communityId, "member"),
  };
}

async function postBy(c: Cast, text = "Buy cheap things now") {
  const { post } = await service.createPost(c.author, c.communityId, { body: body(text) });
  return post;
}

async function reportOutcomes(communityId: CommunityId): Promise<unknown[]> {
  const rows = await adminDb
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(and(eq(outbox.communityId, communityId), eq(outbox.topic, "post_events")));
  return rows.flatMap((row) => {
    const events = (row.payload as { events?: { type: string; payload: unknown }[] }).events ?? [];
    return events.filter((event) => event.type === "report.resolved").map((e) => e.payload);
  });
}

async function auditActions(communityId: CommunityId): Promise<string[]> {
  const rows = await adminDb
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.communityId, communityId));
  return rows.map((row) => row.action).sort();
}

beforeAll(async () => {
  await adminDb.execute(
    sql.raw(`
    select pg_advisory_xact_lock(${migrationLockKey});
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
        create role ${probeRole} nologin nosuperuser nobypassrls;
      end if;
    end $$;
    grant select on communities, users to ${probeRole};
    grant select, insert, update, delete on memberships, posts, post_drafts, agent_identities, post_images, comments, reactions, outbox, categories, content_reports, audit_log, post_follows to ${probeRole};
    grant select on subscriptions, payment_connections, comped_memberships, membership_plans to ${probeRole};
  `),
  );
});

afterAll(async () => {
  await appPool.end();
  await adminPool.end();
});

describe("content reports", () => {
  it("lets members report a post once each and groups reports in the moderation queue", async () => {
    const c = await cast();
    const post = await postBy(c);

    await service.reportPost(c.reporter, c.communityId, post.id, { reason: "spam" });
    await service.reportPost(c.reporter, c.communityId, post.id, { reason: "other" });
    await service.reportPost(c.second, c.communityId, post.id, {
      reason: "harassment",
      note: "  Keeps posting this  ",
    });

    const queue = await service.listReports(c.moderator, c.communityId);
    expect(queue.openCount).toBe(1);
    expect(queue.data).toHaveLength(1);
    const [group] = queue.data;
    expect(group?.content).toMatchObject({
      type: "post",
      id: post.id,
      postId: post.id,
      author: { id: c.author.userId, name: "Ann Author", role: "member" },
      deletedAt: null,
    });
    expect(group?.content.excerpt).toContain("Buy cheap things");
    expect(group?.reportCount).toBe(2);
    expect([...(group?.reasons ?? [])].sort()).toEqual(["harassment", "spam"]);
    expect(group?.notes).toEqual(["Keeps posting this"]);
    expect(limited).toContain(`report:${c.reporter.userId}`);
  });

  it("lets members report a comment and shows it with the comment text", async () => {
    const c = await cast();
    const post = await postBy(c, "A fine post");
    const { comment } = await service.createComment(c.author, c.communityId, post.id, {
      body: body("Rude reply"),
    });

    await service.reportComment(c.reporter, c.communityId, comment.id, { reason: "harassment" });

    const queue = await service.listReports(c.admin, c.communityId);
    expect(queue.data[0]?.content).toMatchObject({
      type: "comment",
      id: comment.id,
      postId: post.id,
      excerpt: "Rude reply",
    });
  });

  it("refuses reports of your own content, deleted content, and invalid input", async () => {
    const c = await cast();
    const post = await postBy(c);
    await expect(
      service.reportPost(c.author, c.communityId, post.id, { reason: "spam" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.reportPost(c.reporter, c.communityId, newId(), { reason: "spam" }),
    ).rejects.toBeInstanceOf(PostNotFoundError);
    await expect(
      service.reportComment(c.reporter, c.communityId, newId(), { reason: "spam" }),
    ).rejects.toBeInstanceOf(CommentNotFoundError);
    await expect(
      service.reportPost(c.reporter, c.communityId, post.id, {
        reason: "spam",
        note: "x".repeat(501),
      }),
    ).rejects.toBeInstanceOf(PostValidationError);
  });

  it("refuses reports from people who are not members", async () => {
    const c = await cast();
    const post = await postBy(c);
    const outsider = await newUser("Outsider");
    await expect(
      service.reportPost(outsider, c.communityId, post.id, { reason: "spam" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("shows the queue to moderators, admins, and the owner only", async () => {
    const c = await cast();
    for (const staff of [c.moderator, c.admin, c.owner]) {
      await expect(service.listReports(staff, c.communityId)).resolves.toMatchObject({
        openCount: 0,
      });
    }
    await expect(service.listReports(c.reporter, c.communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      service.dismissReports(c.reporter, c.communityId, { type: "post", id: newId() }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("dismisses reports, records who and when, and writes the audit log", async () => {
    const c = await cast();
    const post = await postBy(c);
    await service.reportPost(c.reporter, c.communityId, post.id, { reason: "spam" });

    const result = await service.dismissReports(c.moderator, c.communityId, {
      type: "post",
      id: post.id,
    });

    expect(result).toEqual({ resolved: 1 });
    expect((await service.listReports(c.owner, c.communityId)).openCount).toBe(0);
    const closed = await service.listReports(c.owner, c.communityId, { status: "closed" });
    expect(closed.data[0]).toMatchObject({ status: "dismissed", resolvedBy: "Mia Moderator" });
    expect(closed.data[0]?.resolvedAt).toBeInstanceOf(Date);
    expect(await auditActions(c.communityId)).toEqual(["report.dismissed"]);
    expect(await reportOutcomes(c.communityId)).toEqual([
      {
        communityId: c.communityId,
        postId: post.id,
        commentId: null,
        reporterIds: [c.reporter.userId],
        resolution: "dismissed",
        resolvedBy: c.moderator.userId,
      },
    ]);
  });

  it("resolves reports when a moderator deletes the content", async () => {
    const c = await cast();
    const post = await postBy(c, "Thread");
    const { comment } = await service.createComment(c.author, c.communityId, post.id, {
      body: body("Bad comment"),
    });
    await service.reportComment(c.reporter, c.communityId, comment.id, { reason: "hate" });

    await service.deleteComment(c.moderator, c.communityId, comment.id);

    const [row] = await adminDb
      .select()
      .from(contentReports)
      .where(eq(contentReports.commentId, comment.id));
    expect(row).toMatchObject({ status: "content_removed", resolvedBy: c.moderator.userId });
    expect(await auditActions(c.communityId)).toEqual(["report.resolved"]);
    expect(await reportOutcomes(c.communityId)).toEqual([
      expect.objectContaining({
        commentId: comment.id,
        reporterIds: [c.reporter.userId],
        resolution: "content_removed",
      }),
    ]);
  });

  it("keeps reports open when the author deletes their own post", async () => {
    const c = await cast();
    const post = await postBy(c);
    await service.reportPost(c.reporter, c.communityId, post.id, { reason: "spam" });

    await service.deletePost(c.author, c.communityId, post.id);

    const queue = await service.listReports(c.moderator, c.communityId);
    expect(queue.data[0]?.status).toBe("open");
    expect(queue.data[0]?.content.deletedAt).toBeInstanceOf(Date);
  });

  it("keeps reports open when the ban is refused", async () => {
    const c = await cast();
    const post = await postBy(c);
    await service.reportPost(c.reporter, c.communityId, post.id, { reason: "spam" });

    await expect(
      service.resolveReportsWithBan(c.moderator, c.communityId, { type: "post", id: post.id }, () =>
        Promise.reject(new ForbiddenError("ban", "membership")),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await service.listReports(c.moderator, c.communityId)).openCount).toBe(1);
  });

  it("bans the author and marks the reports resolved by the ban", async () => {
    const c = await cast();
    const post = await postBy(c);
    await service.reportPost(c.reporter, c.communityId, post.id, { reason: "violence" });

    const banned: string[] = [];
    await service.resolveReportsWithBan(
      c.admin,
      c.communityId,
      { type: "post", id: post.id },
      async (authorId) => {
        banned.push(authorId);
      },
    );

    expect(banned).toEqual([c.author.userId]);
    const closed = await service.listReports(c.admin, c.communityId, { status: "closed" });
    expect(closed.data[0]?.status).toBe("member_banned");
  });

  it("keeps each community's reports apart", async () => {
    const a = await cast();
    const b = await cast();
    const post = await postBy(a);
    await service.reportPost(a.reporter, a.communityId, post.id, { reason: "spam" });

    expect((await service.listReports(b.owner, b.communityId)).data).toEqual([]);
    await expect(
      service.dismissReports(b.owner, b.communityId, { type: "post", id: post.id }),
    ).rejects.toBeInstanceOf(PostNotFoundError);
    await expect(service.listReports(b.owner, a.communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      service.reportPost(b.reporter, a.communityId, post.id, { reason: "spam" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("counts open report groups for staff only, per community", async () => {
    const a = await cast();
    const b = await cast();
    const post = await postBy(a);
    await service.reportPost(a.reporter, a.communityId, post.id, { reason: "spam" });

    for (const staff of [a.moderator, a.admin, a.owner]) {
      expect(await service.countOpenReports(staff, a.communityId)).toBe(1);
    }
    expect(await service.countOpenReports(b.owner, b.communityId)).toBe(0);
    await expect(service.countOpenReports(a.reporter, a.communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(service.countOpenReports(b.owner, a.communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("lets the database show reporters only their own reports without the manager flag", async () => {
    const c = await cast();
    const post = await postBy(c);
    await service.reportPost(c.reporter, c.communityId, post.id, { reason: "spam" });
    await service.reportPost(c.second, c.communityId, post.id, { reason: "spam" });

    const visible = (settings: Record<string, string>) =>
      appDb.transaction(async (tx) => {
        for (const [name, value] of Object.entries(settings)) {
          await tx.execute(sql`select set_config(${name}, ${value}, true)`);
        }
        return tx
          .select({ reporterId: contentReports.reporterId })
          .from(contentReports)
          .where(and(eq(contentReports.postId, post.id)));
      });

    expect(await visible({})).toEqual([]);
    expect(await visible({ "app.community_id": c.communityId })).toEqual([]);
    expect(
      await visible({ "app.community_id": c.communityId, "app.user_id": c.reporter.userId }),
    ).toEqual([{ reporterId: c.reporter.userId }]);
    expect(
      await visible({ "app.community_id": c.communityId, "app.community_manager": "on" }),
    ).toHaveLength(2);
    await expect(
      appDb.transaction(async (tx) => {
        await setRlsValue(tx, "community_id", c.communityId);
        await setRlsValue(tx, "user_id", c.reporter.userId);
        await tx
          .update(contentReports)
          .set({ status: "dismissed", resolvedAt: new Date() })
          .where(eq(contentReports.postId, post.id));
        return tx
          .select({ status: contentReports.status })
          .from(contentReports)
          .where(eq(contentReports.reporterId, c.reporter.userId));
      }),
    ).resolves.toEqual([{ status: "open" }]);
  });
});
