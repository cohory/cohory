import type { Actor, CommunityRole } from "@cohory/authz";
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
import { communities, memberships, postFollows, users } from "@cohory/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemberEmailTooSoonError, PostNotFoundError } from "./errors";
import { createPostgresPostsRepository } from "./postgres-repository";
import { createPostsService } from "./service";

const probeRole = "cohory_posts_probe";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const adminPool = createPool(adminUrl);
const adminDb = createDb(adminPool);
const appUrl = new URL(adminUrl);
appUrl.searchParams.set("options", `-c role=${probeRole}`);
const appPool = createPool(appUrl.toString());
const appDb = createDb(appPool);

const hourMs = 60 * 60 * 1000;
let clock = Date.UTC(2026, 2, 1);
const service = createPostsService({
  repo: createPostgresPostsRepository(appDb),
  storage: {
    put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
    publicUrl: (key) => `/files/${key}`,
  },
  now: () => new Date((clock += 1000)),
});

type UserActor = Actor & { kind: "user" };

async function newCommunity(): Promise<CommunityId> {
  const community = await createCommunity(adminDb, {
    slug: communitySlugSchema.parse(`life-${newId().slice(-12)}`),
    name: "Feed life",
    privacy: "private",
  });
  return community.id;
}

async function join(communityId: CommunityId, role: CommunityRole = "member"): Promise<UserActor> {
  const [row] = await adminDb
    .insert(users)
    .values({ name: `${role} ${newId().slice(-4)}`, email: `life-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!row) {
    throw new Error("user insert returned no row");
  }
  await addMembership(withCommunity(adminDb, communityId), {
    userId: row.id,
    role,
    status: "active",
    joinedAt: new Date(),
  });
  return { kind: "user", userId: row.id, platformAdmin: false };
}

function body(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

async function followers(postId: string): Promise<string[]> {
  const rows = await adminDb
    .select({ userId: postFollows.userId })
    .from(postFollows)
    .where(eq(postFollows.postId, postId));
  return rows.map((row) => row.userId).sort();
}

let communityA: CommunityId;
let communityB: CommunityId;
let ownerA: UserActor;
let modA: UserActor;
let memberA: UserActor;
let ownerB: UserActor;

beforeAll(async () => {
  await adminDb.execute(
    sql.raw(`
    select pg_advisory_xact_lock(${migrationLockKey});
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
        create role ${probeRole} nologin nosuperuser nobypassrls;
      end if;
    end $$;
    grant select, update on communities to ${probeRole};
    grant select on users to ${probeRole};
    grant select, insert, update, delete on memberships, posts, post_drafts, agent_identities, post_images, comments, reactions, outbox, categories, content_reports, audit_log, post_follows to ${probeRole};
    grant select on subscriptions, payment_connections, comped_memberships, membership_plans to ${probeRole};
  `),
  );
  communityA = await newCommunity();
  communityB = await newCommunity();
  ownerA = await join(communityA, "owner");
  modA = await join(communityA, "moderator");
  memberA = await join(communityA);
  ownerB = await join(communityB, "owner");
});

afterAll(async () => {
  await appPool.end();
  await adminPool.end();
});

describe("following posts in Postgres", () => {
  it("stores a follow under row level security and shows it only to the follower", async () => {
    const { post } = await service.createPost(ownerA, communityA, { body: body("Ask me") });

    await service.followPost(memberA, communityA, post.id);

    expect(await followers(post.id)).toEqual([memberA.userId]);
    expect((await service.getPost(memberA, communityA, post.id)).viewerFollows).toBe(true);
    expect((await service.getPost(modA, communityA, post.id)).viewerFollows).toBe(false);

    await service.unfollowPost(memberA, communityA, post.id);
    expect(await followers(post.id)).toEqual([]);
  });

  it("follows the post for a commenter, once, and not for the post author", async () => {
    const { post } = await service.createPost(ownerA, communityA, { body: body("Thread") });

    await service.createComment(modA, communityA, post.id, { body: body("One") });
    await service.createComment(modA, communityA, post.id, { body: body("Two") });
    await service.createComment(ownerA, communityA, post.id, { body: body("Owner") });

    expect(await followers(post.id)).toEqual([modA.userId]);
  });

  it("cannot follow a post from another community", async () => {
    const { post } = await service.createPost(ownerB, communityB, { body: body("B only") });

    await expect(service.followPost(memberA, communityA, post.id)).rejects.toBeInstanceOf(
      PostNotFoundError,
    );
    expect(await followers(post.id)).toEqual([]);
  });
});

describe("feed cards in Postgres", () => {
  it("returns staff roles, recent commenters, and the last comment time", async () => {
    const { post } = await service.createPost(ownerA, communityA, { body: body("Hello") });
    await service.createComment(memberA, communityA, post.id, { body: body("Hi") });
    const { comment } = await service.createComment(modA, communityA, post.id, {
      body: body("Welcome"),
    });

    const card = await service.getPost(memberA, communityA, post.id);
    const thread = (await service.listComments(memberA, communityA, post.id)).data;

    expect(card.authorRole).toBe("owner");
    expect(card.conversation?.recentCommenters.map((c) => c.id)).toEqual([
      modA.userId,
      memberA.userId,
    ]);
    expect(card.conversation?.lastCommentAt).toEqual(comment.createdAt);
    expect(thread.map((c) => c.authorRole)).toEqual([null, "moderator"]);
  });

  it("reads the feed visit without writing and stores a recorded one", async () => {
    const reader = await join(communityA);

    expect(await service.getFeedVisit(reader, communityA)).toBeNull();
    await service.recordFeedVisit(reader, communityA);
    const seen = await service.getFeedVisit(reader, communityA);

    const [row] = await adminDb
      .select({ at: memberships.lastFeedVisitAt })
      .from(memberships)
      .where(and(eq(memberships.communityId, communityA), eq(memberships.userId, reader.userId)));
    expect(seen).toBeInstanceOf(Date);
    expect(row?.at?.getTime()).toBe(seen?.getTime());
  });
});

describe("emailing a post to members in Postgres", () => {
  it("claims the daily email for the community once and records the sender", async () => {
    const community = await newCommunity();
    const owner = await join(community, "owner");
    const admin = await join(community, "admin");
    const { post } = await service.createPost(owner, community, { body: body("News") });

    const sent = await service.emailPostToMembers(owner, community, post.id);
    await expect(service.emailPostToMembers(admin, community, post.id)).rejects.toBeInstanceOf(
      MemberEmailTooSoonError,
    );
    clock += 24 * hourMs;
    await service.emailPostToMembers(admin, community, post.id);

    const [row] = await adminDb
      .select({ at: communities.memberEmailSentAt, by: communities.memberEmailSentBy })
      .from(communities)
      .where(eq(communities.id, community));
    expect(row?.by).toBe(admin.userId);
    expect(row?.at?.getTime()).toBeGreaterThan(sent.sentAt.getTime());
    expect(await service.getMemberEmailStatus(ownerB, communityB)).toEqual({
      lastSentAt: null,
      nextAvailableAt: null,
    });
  });
});
