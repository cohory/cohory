import type { Actor } from "@cohory/authz";
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
} from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import { outbox, posts, users } from "@cohory/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { countPublishedPosts } from "./counts";
import { createPostgresPostsRepository } from "./postgres-repository";
import { createPostsService, type PostsService } from "./service";

const probeRole = "cohory_posts_scheduler_probe";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const adminPool = createPool(adminUrl);
const adminDb = createDb(adminPool);
const appUrl = new URL(adminUrl);
appUrl.searchParams.set("options", `-c role=${probeRole}`);
const pools = [createPool(appUrl.toString()), createPool(appUrl.toString())];

let now = Date.UTC(2026, 4, 1, 9, 0, 0);
const minute = 60_000;

function serviceOn(index: number): PostsService {
  const pool = pools[index];
  if (!pool) throw new Error("no pool");
  return createPostsService({
    repo: createPostgresPostsRepository(createDb(pool)),
    storage: { put: () => Promise.reject(new Error("unused")), publicUrl: (key) => key },
    now: () => new Date(now),
  });
}

const service = serviceOn(0);
const other = serviceOn(1);

type UserActor = Actor & { kind: "user" };

async function join(communityId: CommunityId): Promise<UserActor> {
  const [row] = await adminDb
    .insert(users)
    .values({ name: "Scheduler", email: `scheduled-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert returned no row");
  await addMembership(withCommunity(adminDb, communityId), {
    userId: row.id,
    role: "member",
    status: "active",
    joinedAt: new Date(),
  });
  return { kind: "user", userId: row.id, platformAdmin: false };
}

function body(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

async function createdEventsFor(postId: string): Promise<number> {
  const match = JSON.stringify({ events: [{ type: "post.created", payload: { postId } }] });
  const rows = await adminDb
    .select({ id: outbox.id })
    .from(outbox)
    .where(and(eq(outbox.topic, "post_events"), sql`${outbox.payload} @> ${match}::jsonb`));
  return rows.length;
}

let communityId: CommunityId;
let author: UserActor;
let reader: UserActor;

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
  const community = await createCommunity(adminDb, {
    slug: communitySlugSchema.parse(`scheduled-${newId().slice(-12)}`),
    name: "Scheduled",
  });
  communityId = community.id;
  author = await join(communityId);
  reader = await join(communityId);
});

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
  await adminPool.end();
});

describe("scheduled posts against Postgres as a non bypass role", () => {
  it("hides a scheduled post from the feed and search until it is published", async () => {
    const { post } = await service.createPost(author, communityId, {
      title: "Zebracrossing",
      body: body("Plans for Monday"),
      scheduledAt: new Date(now + 10 * minute).toISOString(),
    });
    expect((await service.listFeed(reader, communityId)).data.map((p) => p.id)).not.toContain(
      post.id,
    );
    expect(await service.searchPosts(reader, communityId, "zebracrossing", 10)).toEqual([]);
    expect((await service.listScheduledPosts(author, communityId)).map((p) => p.id)).toEqual([
      post.id,
    ]);
    expect(await createdEventsFor(post.id)).toBe(0);

    now += 11 * minute;
    const result = await service.publishDuePosts();

    expect(result.published.map((item) => item.postId)).toContain(post.id);
    expect((await service.listFeed(reader, communityId)).data.map((p) => p.id)).toContain(post.id);
    expect(
      (await service.searchPosts(reader, communityId, "zebracrossing", 10)).map((h) => h.postId),
    ).toEqual([post.id]);
    expect(await createdEventsFor(post.id)).toBe(1);
  });

  it("publishes exactly once under duplicate and concurrent jobs", async () => {
    const { post } = await service.createPost(author, communityId, {
      body: body("Once only"),
      scheduledAt: new Date(now + 2 * minute).toISOString(),
    });
    now += 3 * minute;

    const results = await Promise.all([
      service.publishDuePosts(),
      other.publishDuePosts(),
      service.publishDuePosts(),
      other.publishDuePosts(),
    ]);
    const again = await service.publishDuePosts();

    const winners = results.flatMap((result) =>
      result.published.filter((item) => item.postId === post.id),
    );
    expect(winners).toHaveLength(1);
    expect(again.published).toEqual([]);
    expect(results.flatMap((result) => result.errors)).toEqual([]);
    expect(await createdEventsFor(post.id)).toBe(1);
    const [row] = await adminDb
      .select({ scheduledAt: posts.scheduledAt, createdAt: posts.createdAt })
      .from(posts)
      .where(and(eq(posts.id, post.id), eq(posts.communityId, communityId)));
    expect(row?.scheduledAt).toBeNull();
    expect(row?.createdAt.getTime()).toBe(now);
  });

  it("deletes a cancelled scheduled post without events", async () => {
    const { post } = await service.createPost(author, communityId, {
      body: body("Never mind"),
      scheduledAt: new Date(now + 30 * minute).toISOString(),
    });
    await service.cancelScheduledPost(author, communityId, post.id);
    const rows = await adminDb.select().from(posts).where(eq(posts.id, post.id));
    expect(rows).toEqual([]);
  });

  it("counts published posts only, not scheduled or deleted ones", async () => {
    const quiet = await createCommunity(adminDb, {
      slug: communitySlugSchema.parse(`counted-${newId().slice(-12)}`),
      name: "Counted",
    });
    const writer = await join(quiet.id);
    const appDb = createDb(pools[0] ?? adminPool);
    expect(await countPublishedPosts(appDb, quiet.id)).toBe(0);

    await service.createPost(writer, quiet.id, {
      body: body("Later"),
      scheduledAt: new Date(now + 60 * minute).toISOString(),
    });
    const { post: removed } = await service.createPost(writer, quiet.id, { body: body("Oops") });
    await service.deletePost(writer, quiet.id, removed.id);
    await service.createPost(writer, quiet.id, { body: body("Hello") });

    expect(await countPublishedPosts(appDb, quiet.id)).toBe(1);
    expect(await countPublishedPosts(appDb, communityId)).toBeGreaterThan(0);
  });
});
