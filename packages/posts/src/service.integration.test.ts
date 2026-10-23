import type { Actor, CommunityRole } from "@cohory/authz";
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
import {
  categories,
  comments,
  outbox,
  postImages,
  posts,
  reactions,
  users,
} from "@cohory/db/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CommentNotFoundError, PostNotFoundError } from "./errors";
import { createPostgresPostsRepository } from "./postgres-repository";
import type { PostsRepository } from "./repository";
import { createPostsService } from "./service";

const probeRole = "cohory_posts_probe";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const adminPool = createPool(adminUrl);
const adminDb = createDb(adminPool);
const appUrl = new URL(adminUrl);
appUrl.searchParams.set("options", `-c role=${probeRole}`);
const appPool = createPool(appUrl.toString());
const appDb = createDb(appPool);

let clock = Date.UTC(2026, 0, 1);
const service = createPostsService({
  repo: createPostgresPostsRepository(appDb),
  storage: {
    put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
    publicUrl: (key) => `/files/${key}`,
  },
  now: () => new Date((clock += 1000)),
});

type UserActor = Actor & { kind: "user" };

async function newUser(name = "Person"): Promise<UserActor> {
  const [row] = await adminDb
    .insert(users)
    .values({ name, email: `posts-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!row) {
    throw new Error("user insert returned no row");
  }
  return { kind: "user", userId: row.id, platformAdmin: false };
}

async function newCommunity(privacy: "public" | "private" = "private"): Promise<CommunityId> {
  const community = await createCommunity(adminDb, {
    slug: communitySlugSchema.parse(`posts-${newId().slice(-12)}`),
    name: "Posts",
    privacy,
  });
  return community.id;
}

async function join(communityId: CommunityId, role: CommunityRole = "member"): Promise<UserActor> {
  const actor = await newUser(role);
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

let communityA: CommunityId;
let communityB: CommunityId;
let ownerA: UserActor;
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
    grant select on communities, users to ${probeRole};
    grant select, insert, update, delete on memberships, posts, post_drafts, agent_identities, post_images, comments, reactions, outbox, categories, content_reports, audit_log, post_follows to ${probeRole};
    grant select on subscriptions, payment_connections, comped_memberships, membership_plans to ${probeRole};
  `),
  );
  communityA = await newCommunity();
  communityB = await newCommunity();
  ownerA = await join(communityA, "owner");
  memberA = await join(communityA);
  ownerB = await join(communityB, "owner");
});

afterAll(async () => {
  await appPool.end();
  await adminPool.end();
});

describe("posts service against Postgres as a non bypass role", () => {
  it("creates a post with images and reads it back with the author", async () => {
    const key = `communities/${communityA}/posts/${newId()}.png`;
    const { post } = await service.createPost(memberA, communityA, {
      title: "Hello",
      body: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Hi" }] },
          { type: "image", attrs: { key, width: 2, height: 1 } },
        ],
      },
    });

    const read = await service.getPost(ownerA, communityA, post.id);

    expect(read).toMatchObject({
      title: "Hello",
      author: { id: memberA.userId, name: "member" },
      images: [{ key, url: `/files/${key}`, width: 2, height: 1 }],
      viewerHasLiked: false,
    });
  });

  it("never shows community A's feed to community B, even with forged ids", async () => {
    const { post } = await service.createPost(memberA, communityA, { body: body("only A") });
    const { post: postB } = await service.createPost(ownerB, communityB, { body: body("only B") });

    const feedB = await service.listFeed(ownerB, communityB, { limit: 100 });
    expect(feedB.data.every((p) => p.communityId === communityB)).toBe(true);
    expect(feedB.data.map((p) => p.id)).toContain(postB.id);
    expect(feedB.data.map((p) => p.id)).not.toContain(post.id);

    await expect(service.getPost(ownerB, communityB, post.id)).rejects.toBeInstanceOf(
      PostNotFoundError,
    );
    await expect(
      service.toggleLike(ownerB, communityB, {
        subjectType: "post",
        subjectId: post.id,
        liked: true,
      }),
    ).rejects.toBeInstanceOf(PostNotFoundError);
    await expect(service.deletePost(ownerB, communityB, post.id)).rejects.toBeInstanceOf(
      PostNotFoundError,
    );
    await expect(
      service.createComment(ownerB, communityB, post.id, { body: body("x") }),
    ).rejects.toBeInstanceOf(PostNotFoundError);
  });

  it("answers not found for malformed ids instead of a database error", async () => {
    await expect(service.getPost(memberA, communityA, "not-a-uuid")).rejects.toBeInstanceOf(
      PostNotFoundError,
    );
    await expect(
      service.toggleLike(memberA, communityA, {
        subjectType: "comment",
        subjectId: "x",
        liked: true,
      }),
    ).rejects.toBeInstanceOf(CommentNotFoundError);
    await expect(service.deleteComment(memberA, communityA, "x")).rejects.toBeInstanceOf(
      CommentNotFoundError,
    );
  });

  it("hides soft deleted posts and comments and keeps their rows", async () => {
    const { post } = await service.createPost(memberA, communityA, { body: body("to delete") });
    const { comment } = await service.createComment(memberA, communityA, post.id, {
      body: body("c"),
    });
    await service.createComment(ownerA, communityA, post.id, {
      body: body("reply"),
      parentId: comment.id,
    });

    await service.deleteComment(ownerA, communityA, comment.id);
    expect((await service.listComments(memberA, communityA, post.id)).data).toEqual([]);
    expect((await service.getPost(memberA, communityA, post.id)).commentCount).toBe(0);

    await service.deletePost(memberA, communityA, post.id);
    const feed = await service.listFeed(memberA, communityA, { limit: 100 });
    expect(feed.data.map((p) => p.id)).not.toContain(post.id);

    const [row] = await adminDb.select().from(posts).where(eq(posts.id, post.id));
    expect(row?.deletedAt).toBeInstanceOf(Date);
    const commentRows = await adminDb.select().from(comments).where(eq(comments.postId, post.id));
    expect(commentRows).toHaveLength(2);
    expect(commentRows.every((c) => c.deletedAt !== null)).toBe(true);
  });

  it("keeps like and comment counts right under repeated toggles", async () => {
    const { post } = await service.createPost(memberA, communityA, { body: body("counts") });
    const fans = [ownerA, memberA, await join(communityA), await join(communityA)];
    const like = { subjectType: "post" as const, subjectId: post.id };

    await Promise.all(
      fans.map((fan) => service.toggleLike(fan, communityA, { ...like, liked: true })),
    );
    await Promise.all(
      fans.map((fan) => service.toggleLike(fan, communityA, { ...like, liked: true })),
    );
    await service.toggleLike(fans[0] ?? ownerA, communityA, { ...like, liked: false });
    await service.toggleLike(fans[0] ?? ownerA, communityA, { ...like, liked: false });

    const read = await service.getPost(memberA, communityA, post.id);
    const [stored] = await adminDb
      .select({ value: sql<number>`count(*)::int` })
      .from(reactions)
      .where(eq(reactions.subjectId, post.id));
    expect(read.likeCount).toBe(3);
    expect(stored?.value).toBe(3);
    expect(read.viewerHasLiked).toBe(true);
    expect((await service.getPost(ownerA, communityA, post.id)).viewerHasLiked).toBe(false);

    const { comment } = await service.createComment(memberA, communityA, post.id, {
      body: body("c"),
    });
    await service.toggleLike(ownerA, communityA, {
      subjectType: "comment",
      subjectId: comment.id,
      liked: true,
    });
    const comments = await service.listComments(ownerA, communityA, post.id);
    expect(comments.data[0]).toMatchObject({ likeCount: 1, viewerHasLiked: true });
    expect((await service.getPost(memberA, communityA, post.id)).commentCount).toBe(1);
  });

  it("orders pinned posts first and pages 45 posts without duplicates or gaps", async () => {
    const community = await newCommunity("public");
    const owner = await join(community, "owner");
    const created: string[] = [];
    for (let i = 0; i < 45; i += 1) {
      created.push((await service.createPost(owner, community, { body: body(`n${i}`) })).post.id);
    }
    const pinned = [created[10], created[3]].filter((id): id is string => id !== undefined);
    for (const id of pinned) {
      await service.pinPost(owner, community, id);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await service.listFeed({ kind: "guest" }, community, { cursor });
      seen.push(...page.data.map((p) => p.id));
      cursor = page.nextCursor;
    } while (cursor);

    const rest = [...created].reverse().filter((id) => !pinned.includes(id));
    expect(seen).toEqual([...[...pinned].reverse(), ...rest]);
    expect(new Set(seen).size).toBe(45);
  }, 20_000);
});

describe("row level security on the posts tables", () => {
  it.each(["posts", "post_images", "comments", "reactions"])(
    "is enabled and forced on %s",
    async (table) => {
      const result = await adminDb.execute<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = ${table}`);

      expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    },
  );

  it("returns zero rows to the app role without app.community_id", async () => {
    await service.createPost(memberA, communityA, { body: body("rls") });

    expect(await appDb.select().from(posts)).toEqual([]);
    expect(await appDb.select().from(comments)).toEqual([]);
    expect(await appDb.select().from(reactions)).toEqual([]);
    expect(await appDb.select().from(postImages)).toEqual([]);
  });

  it("rejects a write whose community_id does not match app.community_id", async () => {
    await expect(
      appDb.transaction(async (tx) => {
        await setRlsValue(tx, "community_id", communityA);
        await tx.insert(posts).values({
          communityId: communityB,
          authorId: memberA.userId,
          body: { type: "doc", content: [] },
          bodyHtml: "",
          bodyText: "",
          excerpt: "",
        });
      }),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });
});

describe("moderator deleted state", () => {
  it("records who deleted a post or comment and shows it to moderators only", async () => {
    const communityId = await newCommunity();
    const author = await join(communityId);
    const moderator = await join(communityId, "moderator");
    const { post } = await service.createPost(author, communityId, { body: body("Bye") });
    const { comment } = await service.createComment(author, communityId, post.id, {
      body: body("Note"),
    });

    await service.deleteComment(moderator, communityId, comment.id);
    await service.deletePost(moderator, communityId, post.id);

    const seen = await service.getPost(moderator, communityId, post.id);
    expect(seen.deletion?.by).toEqual({ id: moderator.userId, name: "moderator", image: null });
    expect(seen.deletion?.at).toBeInstanceOf(Date);
    const thread = await service.listComments(moderator, communityId, post.id);
    expect(thread.data.map((c) => c.deletion?.by?.id)).toEqual([moderator.userId]);
    await expect(service.getPost(author, communityId, post.id)).rejects.toBeInstanceOf(
      PostNotFoundError,
    );
  });
});

describe("outbox", () => {
  it("appends the events in the same transaction as the write", async () => {
    const { post, outboxId, events } = await service.createPost(memberA, communityA, {
      body: body("Outbox"),
    });

    const rows = await adminDb
      .select()
      .from(outbox)
      .where(eq(outbox.id, outboxId ?? ""));
    expect(rows).toEqual([
      expect.objectContaining({
        communityId: communityA,
        topic: "post_events",
        payload: { events: JSON.parse(JSON.stringify(events)) },
        publishedAt: null,
        attempts: 0,
      }),
    ]);
    expect(events[0]).toMatchObject({ type: "post.created", payload: { postId: post.id } });
  });

  it("leaves no outbox row when the transaction rolls back after the write", async () => {
    const inner = createPostgresPostsRepository(appDb);
    const failing: PostsRepository = {
      findCommunity: (id) => inner.findCommunity(id),
      listDueScheduledPosts: (now, limit) => inner.listDueScheduledPosts(now, limit),
      inCommunity: (id, fn) =>
        inner.inCommunity(id, async (store) => {
          await fn(store);
          throw new Error("rollback after the write");
        }),
    };
    const ids: string[] = [];
    const rollingBack = createPostsService({
      repo: failing,
      storage: {
        put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
        publicUrl: (k) => k,
      },
      newId: () => {
        const value = newId();
        ids.push(value);
        return value;
      },
    });

    await expect(
      rollingBack.createPost(memberA, communityA, { body: body("Never") }),
    ).rejects.toThrow("rollback after the write");

    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(await adminDb.select().from(outbox).where(eq(outbox.id, id))).toEqual([]);
      expect(await adminDb.select().from(posts).where(eq(posts.id, id))).toEqual([]);
    }
  });

  it("does not let request code read the outbox", async () => {
    await service.createPost(memberA, communityA, { body: body("Hidden") });

    const visible = await appDb.transaction(async (tx) => {
      await setRlsValue(tx, "community_id", communityA);
      return tx.select().from(outbox);
    });

    expect(visible).toEqual([]);
  });

  it("filters the feed by a category and keeps categories inside their community", async () => {
    const general = await service.createCategory(ownerA, communityA, { name: "General" });
    const theirs = await service.createCategory(ownerB, communityB, { name: "General" });
    await service.createPost(memberA, communityA, { body: body("Sorted"), categoryId: general.id });

    const feed = await service.listFeed(memberA, communityA, { category: general.slug });

    expect(general.slug).toBe(theirs.slug);
    expect(feed.data.map((post) => post.excerpt)).toEqual(["Sorted"]);
    expect(feed.data[0]?.category?.id).toBe(general.id);
    await expect(
      service.createPost(memberA, communityA, { body: body("Sneaky"), categoryId: theirs.id }),
    ).rejects.toThrow("category not found");
    expect((await service.listCategories(ownerB, communityB)).map((c) => c.id)).toEqual([
      theirs.id,
    ]);
  });

  it("moves the posts of a deleted category to General under row level security", async () => {
    const existing = (await service.listCategories(ownerA, communityA)).find(
      (category) => category.slug === "general",
    );
    const general =
      existing ?? (await service.createCategory(ownerA, communityA, { name: "General" }));
    const workshops = await service.createCategory(ownerA, communityA, { name: "Workshops" });
    const { post } = await service.createPost(memberA, communityA, {
      body: body("Wheel night"),
      categoryId: workshops.id,
    });

    await service.deleteCategory(ownerA, communityA, workshops.id);

    expect((await service.getPost(memberA, communityA, post.id)).category?.id).toBe(general.id);
  });

  it("keeps categories inside their community at the database level", async () => {
    const mine = await service.createCategory(ownerA, communityA, { name: "Probe A" });
    const theirs = await service.createCategory(ownerB, communityB, { name: "Probe B" });
    const visible = (communityId: string | null) =>
      appDb.transaction(async (tx) => {
        if (communityId) {
          await setRlsValue(tx, "community_id", communityId);
        }
        return (
          await tx
            .select({ id: categories.id })
            .from(categories)
            .where(sql`${categories.id} in (${mine.id}, ${theirs.id})`)
        ).map((row) => row.id);
      });

    expect(await visible(null)).toEqual([]);
    expect(await visible(communityA)).toEqual([mine.id]);
    expect(await visible(communityB)).toEqual([theirs.id]);
    await expect(
      appDb.transaction(async (tx) => {
        await setRlsValue(tx, "community_id", communityA);
        await tx
          .insert(categories)
          .values({ communityId: communityB, name: "Sneaky", slug: "sneaky", position: 99 });
      }),
    ).rejects.toSatisfy((error: unknown) =>
      /row-level security/.test(String(error instanceof Error ? (error.cause ?? error) : error)),
    );
  });

  it("sorts the feed by newest, latest activity, and top score with pinned posts first", async () => {
    const communityId = await newCommunity();
    const owner = await join(communityId, "owner");
    const fans = [await join(communityId), await join(communityId), await join(communityId)];
    const create = async (text: string) =>
      (await service.createPost(owner, communityId, { body: body(text) })).post.id;
    const first = await create("First");
    const second = await create("Second");
    const third = await create("Third");
    const pinned = await create("Pinned");
    await service.pinPost(owner, communityId, pinned);
    await service.createComment(owner, communityId, first, { body: body("Bump") });
    for (const fan of fans) {
      await service.toggleLike(fan, communityId, {
        subjectType: "post",
        subjectId: second,
        liked: true,
      });
    }
    const order = async (sort: "active" | "new" | "top") =>
      (await service.listFeed(owner, communityId, { sort })).data.map((post) => post.id);

    expect(await order("new")).toEqual([pinned, third, second, first]);
    expect(await order("active")).toEqual([pinned, first, third, second]);
    expect(await order("top")).toEqual([pinned, second, first, third]);

    const pages: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof service.listFeed>> = await service.listFeed(
        owner,
        communityId,
        { sort: "top", limit: 1, cursor },
      );
      pages.push(...page.data.map((post) => post.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(pages).toEqual([pinned, second, first, third]);
  });
});
