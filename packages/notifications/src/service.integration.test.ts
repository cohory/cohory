import { UnauthenticatedError, type Actor, type CommunityRole } from "@cohory/authz";
import {
  addMembership,
  communitySlugSchema,
  createCommunity,
  createDb,
  createPool,
  newId,
  parseAdminDatabaseEnv,
  runInCommunity,
  setMembershipStatus,
  setRlsFlag,
  setRlsValue,
  withCommunity,
  type CommunityId,
} from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import {
  notifications,
  paymentConnections,
  paymentCustomers,
  subscriptions,
  users,
} from "@cohory/db/schema";
import { createPostgresPostsRepository, createPostsService, type PostEvent } from "@cohory/posts";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NotificationValidationError } from "./errors";
import { createNotificationsFanout } from "./fanout";
import { createNotificationsService } from "./service";

const probeRole = "cohory_notifications_probe";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const adminPool = createPool(adminUrl);
const adminDb = createDb(adminPool);
const appUrl = new URL(adminUrl);
appUrl.searchParams.set("options", `-c role=${probeRole}`);
const appPool = createPool(appUrl.toString());
const appDb = createDb(appPool);

let clock = Date.UTC(2026, 0, 1);
const now = () => new Date((clock += 1000));
const posts = createPostsService({
  repo: createPostgresPostsRepository(appDb),
  storage: {
    put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
    publicUrl: (key) => `/files/${key}`,
  },
  now,
});
const fanOut = createNotificationsFanout({ db: appDb, now });
const service = createNotificationsService({ db: appDb, now });

type UserActor = Actor & { kind: "user" };

async function newUser(name: string): Promise<UserActor> {
  const [row] = await adminDb
    .insert(users)
    .values({ name, email: `notif-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!row) {
    throw new Error("user insert returned no row");
  }
  return { kind: "user", userId: row.id, platformAdmin: false };
}

async function newCommunity(name: string): Promise<CommunityId> {
  const community = await createCommunity(adminDb, {
    slug: communitySlugSchema.parse(`notif-${newId().slice(-12)}`),
    name,
  });
  return community.id;
}

async function join(
  communityId: CommunityId,
  actor: UserActor,
  role: CommunityRole = "member",
): Promise<void> {
  await addMembership(withCommunity(adminDb, communityId), {
    userId: actor.userId,
    role,
    status: "active",
    joinedAt: new Date(),
  });
}

function text(value: string): unknown {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
  };
}

function mentioning(user: UserActor, label: string): unknown {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Hi " },
          { type: "mention", attrs: { id: user.userId, label } },
        ],
      },
    ],
  };
}

let community: CommunityId;
let otherCommunity: CommunityId;
let ada: UserActor;
let bob: UserActor;
let cy: UserActor;

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
    grant select, insert, update, delete on memberships, posts, post_drafts, agent_identities, post_images, comments, reactions, notifications, outbox, notification_preferences, notification_deliveries, notification_group_sources, post_follows to ${probeRole};
    grant select on subscriptions, payment_connections, payment_customers, comped_memberships, membership_plans to ${probeRole};
  `),
  );
  community = await newCommunity("Makers");
  otherCommunity = await newCommunity("Gardeners");
  ada = await newUser("Ada");
  bob = await newUser("Bob");
  cy = await newUser("Cy");
  for (const actor of [ada, bob, cy]) {
    await join(community, actor);
  }
  await join(otherCommunity, ada);
  await join(otherCommunity, bob);
});

afterAll(async () => {
  await appPool.end();
  await adminPool.end();
});

async function lapsePaidAccess(communityId: CommunityId, userId: string): Promise<void> {
  const ended = new Date("2025-12-01T00:00:00Z");
  await runInCommunity(withCommunity(adminDb, communityId), async ({ tx, values }) => {
    await setRlsFlag(tx, "payments_manager");
    const [connection] = await tx
      .insert(paymentConnections)
      .values(
        values({
          provider: "stripe_connect" as const,
          status: "disconnected" as const,
          disconnectedAt: ended,
        }),
      )
      .returning({ id: paymentConnections.id });
    if (!connection) throw new Error("no connection");
    const [customer] = await tx
      .insert(paymentCustomers)
      .values(values({ userId, connectionId: connection.id, externalCustomerId: `cus_${newId()}` }))
      .returning({ id: paymentCustomers.id });
    if (!customer) throw new Error("no customer");
    await tx.insert(subscriptions).values(
      values({
        userId,
        customerId: customer.id,
        connectionId: connection.id,
        externalSubscriptionId: `sub_${newId()}`,
        providerStatus: "active",
        accessState: "granted" as const,
        currentPeriodEnd: ended,
        cancelAtPeriodEnd: false,
        applicationFeeBps: 200,
        providerFetchedAt: ended,
      }),
    );
  });
}

async function rowsFor(userId: string) {
  return adminDb.select().from(notifications).where(eq(notifications.userId, userId));
}

async function asProbeUser<T>(
  userId: string | null,
  fn: (tx: Parameters<Parameters<typeof adminDb.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return adminDb.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local role ${probeRole}`));
    if (userId) {
      await setRlsValue(tx, "user_id", userId);
    }
    return fn(tx);
  });
}

describe("notifications end to end through the posts service", () => {
  it("notifies the post author after a comment is fanned out", async () => {
    const { post } = await posts.createPost(ada, community, { body: text("A question") });
    const { comment, events } = await posts.createComment(bob, community, post.id, {
      body: text("An answer"),
    });

    await fanOut(events);

    const page = await service.listNotifications(ada, { limit: 5 });
    expect(page.data[0]).toMatchObject({
      type: "comment_on_post",
      text: "Bob commented on your post",
      actor: { id: bob.userId, name: "Bob" },
      community: { id: community, name: "Makers" },
      subjectType: "comment",
      subjectId: comment.id,
      postId: post.id,
      readAt: null,
    });
  });

  it("notifies the parent author of a reply and the mentioned member", async () => {
    const { post } = await posts.createPost(ada, community, { body: text("Thread") });
    const parent = await posts.createComment(cy, community, post.id, { body: text("First") });
    const reply = await posts.createComment(bob, community, post.id, {
      body: mentioning(ada, "Ada"),
      parentId: parent.comment.id,
    });

    await fanOut([...parent.events, ...reply.events]);

    const forCy = await service.listNotifications(cy, { limit: 1 });
    expect(forCy.data[0]).toMatchObject({ type: "reply", text: "Bob replied to your comment" });
    const forAda = await service.listNotifications(ada, { limit: 2 });
    expect(forAda.data.map((n) => n.text)).toEqual([
      "Bob mentioned you in a comment",
      "Cy commented on your post",
    ]);
  });

  it("notifies the people who follow a post, but not the commenter or someone who unfollowed", async () => {
    const dee = await newUser("Dee");
    const eve = await newUser("Eve");
    await join(community, dee);
    await join(community, eve);
    const { post } = await posts.createPost(ada, community, { body: text("Kiln schedule") });
    await posts.followPost(dee, community, post.id);
    await posts.followPost(eve, community, post.id);
    await posts.unfollowPost(eve, community, post.id);
    const { comment, events } = await posts.createComment(bob, community, post.id, {
      body: text("Thursday works"),
    });

    await fanOut(events);

    expect(await rowsFor(dee.userId)).toEqual([
      expect.objectContaining({
        type: "comment_on_followed_post",
        subjectId: comment.id,
        actorId: bob.userId,
        detail: "Thursday works",
      }),
    ]);
    expect(await rowsFor(eve.userId)).toEqual([]);
    expect((await rowsFor(bob.userId)).filter((row) => row.postId === post.id)).toEqual([]);
    expect((await service.listNotifications(dee, { limit: 1 })).data[0]?.text).toBe(
      "Bob commented on a post you follow",
    );
  });

  it("stops telling a follower whose paid access lapsed, who can still unfollow", async () => {
    const paid = await newCommunity("Paid followers");
    const dee = await newUser("Dee");
    await join(paid, dee);
    await join(paid, bob);
    await join(paid, ada);
    const { post } = await posts.createPost(ada, paid, { body: text("Members only") });
    await posts.followPost(dee, paid, post.id);
    await lapsePaidAccess(paid, dee.userId);
    const { events } = await posts.createComment(bob, paid, post.id, { body: text("Hi") });

    await fanOut(events);

    expect(await rowsFor(dee.userId)).toEqual([]);
    await expect(posts.unfollowPost(dee, paid, post.id)).resolves.toEqual({ following: false });
  });
});

describe("notification previews", () => {
  it("shows the first line of the comment and clears it when the comment is deleted", async () => {
    const { post } = await posts.createPost(ada, community, { body: text("Kiln day") });
    const { comment, events } = await posts.createComment(bob, community, post.id, {
      body: text("Love the glaze"),
    });
    await fanOut(events);

    const before = await service.listNotifications(ada, { limit: 1 });
    expect(before.data[0]).toMatchObject({ subjectId: comment.id, preview: "Love the glaze" });

    await posts.deleteComment(bob, community, comment.id);
    await fanOut([
      {
        type: "comment.deleted",
        payload: {
          communityId: community,
          postId: post.id,
          commentId: comment.id,
          authorId: bob.userId,
          occurredAt: now().toISOString(),
          likes: [],
        },
      },
    ]);

    const after = await service.listNotifications(ada, { limit: 1 });
    expect(after.data[0]).toMatchObject({ subjectId: comment.id, preview: null });
  });

  it("leaves the preview out for a member whose paid access lapsed", async () => {
    const paid = await newCommunity("Paid makers");
    const dee = await newUser("Dee");
    await join(paid, dee);
    await join(paid, bob);
    const { post } = await posts.createPost(dee, paid, { body: text("Members only") });
    await lapsePaidAccess(paid, dee.userId);

    await fanOut([
      {
        type: "comment.created",
        payload: {
          communityId: paid,
          postId: post.id,
          commentId: newId(),
          parentId: null,
          parentAuthorId: null,
          authorId: bob.userId,
          postAuthorId: dee.userId,
          mentionedUserIds: [],
          preview: "Secret plans",
        },
      },
    ]);

    const [row] = await rowsFor(dee.userId);
    expect(row).toMatchObject({ type: "comment_on_post", detail: null });
  });

  it("clears the previews of a deleted post's mentions and comments", async () => {
    const created = await posts.createPost(bob, community, { body: mentioning(cy, "Cy") });
    await fanOut(created.events);
    expect((await service.listNotifications(cy, { limit: 1 })).data[0]?.preview).toMatch(/^Hi/);

    await posts.deletePost(bob, community, created.post.id);
    await fanOut([
      {
        type: "post.deleted",
        payload: {
          communityId: community,
          postId: created.post.id,
          authorId: bob.userId,
          occurredAt: now().toISOString(),
          likes: [],
        },
      },
    ]);

    expect((await service.listNotifications(cy, { limit: 1 })).data[0]?.preview).toBeNull();
  });
});

describe("fan-out", () => {
  it("inserts one unread row per recipient, type, subject, and actor when events repeat", async () => {
    const { post, events } = await posts.createPost(bob, community, { body: mentioning(cy, "Cy") });

    await fanOut(events);
    await fanOut(events);

    const rows = (await rowsFor(cy.userId)).filter((row) => row.subjectId === post.id);
    expect(rows).toHaveLength(1);
  });

  it("does not notify a user who is no longer a member", async () => {
    const leaver = await newUser("Leaver");
    await join(community, leaver);
    const { post } = await posts.createPost(leaver, community, { body: text("Bye") });
    await setMembershipStatus(withCommunity(adminDb, community), leaver.userId, "removed");
    const { events } = await posts.createComment(bob, community, post.id, { body: text("Hi") });

    await fanOut(events);

    expect(await rowsFor(leaver.userId)).toEqual([]);
  });

  it("groups likes on one post into one unread notice and skips a repeated liker", async () => {
    const author = await newUser("Author");
    const fans = [await newUser("Jamie Lee"), await newUser("Taylor"), await newUser("Sam")];
    await join(community, author);
    for (const fan of fans) await join(community, fan);
    const { post } = await posts.createPost(author, community, { body: text("Like me") });
    const like = (fan: UserActor) =>
      posts.toggleLike(fan, community, { subjectType: "post", subjectId: post.id, liked: true });

    for (const fan of fans) {
      const { events } = await like(fan);
      await fanOut(events);
      await fanOut(events);
    }

    const page = await service.listNotifications(author);
    expect(page.data.map((n) => [n.type, n.text, n.postId])).toEqual([
      ["like_on_post", "Sam and 2 others liked your post", post.id],
    ]);
    expect(await service.unreadCount(author)).toBe(1);
  });

  it("counts a redelivered like once after another person liked in between", async () => {
    const author = await newUser("Author");
    const ana = await newUser("Ana");
    const ben = await newUser("Ben");
    for (const actor of [author, ana, ben]) await join(community, actor);
    const { post } = await posts.createPost(author, community, { body: text("A B A") });
    const like = (fan: UserActor) =>
      posts.toggleLike(fan, community, { subjectType: "post", subjectId: post.id, liked: true });

    const first = (await like(ana)).events;
    await fanOut(first);
    await fanOut((await like(ben)).events);
    await fanOut(first);

    const page = await service.listNotifications(author);
    expect(page.data.map((n) => n.text)).toEqual(["Ben and 1 other liked your post"]);
  });

  it("does not count a like again after an unlike and a relike", async () => {
    const author = await newUser("Author");
    const ana = await newUser("Ana");
    const ben = await newUser("Ben");
    for (const actor of [author, ana, ben]) await join(community, actor);
    const { post } = await posts.createPost(author, community, { body: text("Relike") });
    const like = (fan: UserActor, liked: boolean) =>
      posts.toggleLike(fan, community, { subjectType: "post", subjectId: post.id, liked });

    await fanOut((await like(ana, true)).events);
    await fanOut((await like(ben, true)).events);
    await fanOut((await like(ana, false)).events);
    await fanOut((await like(ana, true)).events);

    const page = await service.listNotifications(author);
    expect(page.data.map((n) => n.text)).toEqual(["Ben and 1 other liked your post"]);
  });

  it("counts a report once when its job is retried after a later report joined the group", async () => {
    const place = await newCommunity("Report retry");
    const owner = await newUser("Owner");
    const reporter = await newUser("Reporter");
    await join(place, owner, "owner");
    await join(place, reporter);
    const report = (): PostEvent => ({
      type: "report.created",
      payload: {
        communityId: place,
        reportId: newId(),
        postId: newId(),
        commentId: null,
        reporterId: reporter.userId,
      },
    });
    const first = report();

    await fanOut([first]);
    await fanOut([report()]);
    await fanOut([first]);

    const page = await service.listNotifications(owner);
    expect(page.data.map((n) => n.text)).toEqual(["2 new reports are waiting for review"]);
  });

  it("starts a new like group after the author read the earlier one", async () => {
    const author = await newUser("Author");
    const first = await newUser("First");
    const second = await newUser("Second");
    for (const actor of [author, first, second]) await join(community, actor);
    const { post } = await posts.createPost(author, community, { body: text("Again") });
    const { comment } = await posts.createComment(author, community, post.id, {
      body: text("A comment"),
    });
    const likeComment = (fan: UserActor) =>
      posts.toggleLike(fan, community, {
        subjectType: "comment",
        subjectId: comment.id,
        liked: true,
      });

    await fanOut((await likeComment(first)).events);
    await service.markAllRead(author);
    await fanOut((await likeComment(second)).events);

    const page = await service.listNotifications(author);
    expect(page.data.map((n) => [n.text, n.readAt === null, n.href])).toEqual([
      ["Second liked your comment", true, `/c/${page.data[0]?.community.slug}/posts/${post.id}`],
      ["First liked your comment", false, `/c/${page.data[0]?.community.slug}/posts/${post.id}`],
    ]);
  });

  it("does not notify a self like", async () => {
    const author = await newUser("Self");
    await join(community, author);
    const { post } = await posts.createPost(author, community, { body: text("Mine") });
    const like = await posts.toggleLike(author, community, {
      subjectType: "post",
      subjectId: post.id,
      liked: true,
    });

    expect(await fanOut(like.events)).toEqual({ inserted: 0 });
    expect(await rowsFor(author.userId)).toEqual([]);
  });

  it("tells moderators, admins, and the owner about reports, grouped within the hour", async () => {
    const place = await newCommunity("Reports");
    const owner = await newUser("Owner");
    const moderator = await newUser("Mod");
    const regular = await newUser("Regular");
    const reporter = await newUser("Reporter");
    await join(place, owner, "owner");
    await join(place, moderator, "moderator");
    await join(place, regular);
    await join(place, reporter);
    const report = (): PostEvent => ({
      type: "report.created",
      payload: {
        communityId: place,
        reportId: newId(),
        postId: newId(),
        commentId: null,
        reporterId: reporter.userId,
      },
    });
    const first = report();

    await fanOut([first]);
    await fanOut([first]);
    await fanOut([report()]);
    await fanOut([report()]);

    for (const staff of [owner, moderator]) {
      const page = await service.listNotifications(staff);
      expect(page.data.map((n) => [n.type, n.text, n.href])).toEqual([
        [
          "report_created",
          "3 new reports are waiting for review",
          expect.stringMatching(/\/manage\/inbox\?tab=reports$/),
        ],
      ]);
    }
    expect(await rowsFor(regular.userId)).toEqual([]);
    expect(await rowsFor(reporter.userId)).toEqual([]);

    clock += 2 * 60 * 60 * 1000;
    await fanOut([report()]);
    const later = await service.listNotifications(owner);
    expect(later.data.map((n) => n.text)).toEqual([
      "A new report is waiting for review",
      "3 new reports are waiting for review",
    ]);
  });
});

describe("notifications row level security", () => {
  it("is enabled and forced on the table", async () => {
    const result = await adminDb.execute<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'notifications'`,
    );

    expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("shows a user only their own rows through the app role", async () => {
    const { events } = await posts.createPost(cy, community, { body: mentioning(bob, "Bob") });
    await fanOut(events);

    const asAda = await asProbeUser(ada.userId, (tx) => tx.select().from(notifications));
    const asNobody = await asProbeUser(null, (tx) => tx.select().from(notifications));

    expect(asAda.length).toBeGreaterThan(0);
    expect(asAda.every((row) => row.userId === ada.userId)).toBe(true);
    expect(asNobody).toEqual([]);
  });

  it("does not let a user mark another user's rows read", async () => {
    const { events } = await posts.createPost(cy, community, { body: mentioning(bob, "Bob") });
    await fanOut(events);
    const bobRows = await rowsFor(bob.userId);

    const updated = await asProbeUser(ada.userId, (tx) =>
      tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(eq(notifications.userId, bob.userId))
        .returning({ id: notifications.id }),
    );
    await service.markRead(ada, { ids: bobRows.map((row) => row.id) });

    expect(updated).toEqual([]);
    expect((await rowsFor(bob.userId)).filter((row) => row.readAt !== null)).toEqual([]);
  });

  it("refuses an insert outside the community scope", async () => {
    const [row] = await rowsFor(bob.userId);
    if (!row) {
      throw new Error("expected a notification for Bob");
    }
    const copy = {
      communityId: row.communityId,
      userId: row.userId,
      actorId: row.actorId,
      type: "reply" as const,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      postId: row.postId,
    };

    await expect(
      asProbeUser(bob.userId, (tx) => tx.insert(notifications).values(copy)),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });
});

describe("notifications service", () => {
  it("pages newest first with a cursor across communities", async () => {
    const reader = await newUser("Reader");
    await join(community, reader);
    await join(otherCommunity, reader);
    for (const where of [community, otherCommunity, community, otherCommunity, community]) {
      const { events } = await posts.createPost(bob, where, { body: mentioning(reader, "R") });
      await fanOut(events);
    }

    const seen: string[] = [];
    const created: number[] = [];
    let cursor: string | undefined;
    for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
      const page = await service.listNotifications(reader, { cursor, limit: 2 });
      seen.push(...page.data.map((n) => n.id));
      created.push(...page.data.map((n) => n.createdAt.getTime()));
      cursor = page.nextCursor ?? undefined;
      if (pageIndex < 2) {
        expect(page.nextCursor).not.toBeNull();
      } else {
        expect(page.nextCursor).toBeNull();
      }
    }

    expect(new Set(seen).size).toBe(5);
    expect(created).toEqual([...created].sort((a, b) => b - a));
    expect(await service.unreadCount(reader)).toBe(5);
    expect(await service.unreadCountsByCommunity(reader)).toEqual(
      new Map([
        [community, 3],
        [otherCommunity, 2],
      ]),
    );
  });

  it("hides notifications from a community the user left", async () => {
    const leaver = await newUser("Leaver two");
    await join(otherCommunity, leaver);
    const { events } = await posts.createPost(bob, otherCommunity, {
      body: mentioning(leaver, "L"),
    });
    await fanOut(events);
    expect(await service.unreadCount(leaver)).toBe(1);

    await setMembershipStatus(withCommunity(adminDb, otherCommunity), leaver.userId, "removed");

    expect(await service.unreadCount(leaver)).toBe(0);
    expect((await service.listNotifications(leaver)).data).toEqual([]);
  });

  it("marks notifications read idempotently", async () => {
    const reader = await newUser("Idempotent");
    await join(community, reader);
    for (let i = 0; i < 2; i += 1) {
      const { events } = await posts.createPost(bob, community, { body: mentioning(reader, "I") });
      await fanOut(events);
    }
    const { data } = await service.listNotifications(reader);
    const first = data[0];
    if (!first) {
      throw new Error("expected a notification");
    }

    expect(await service.markRead(reader, { ids: [first.id] })).toEqual({ unreadCount: 1 });
    const readAt = (await service.listNotifications(reader)).data[0]?.readAt;
    expect(await service.markRead(reader, { ids: [first.id] })).toEqual({ unreadCount: 1 });
    expect((await service.listNotifications(reader)).data[0]?.readAt).toEqual(readAt);

    expect(await service.markAllRead(reader)).toEqual({ unreadCount: 0 });
    expect(await service.markAllRead(reader)).toEqual({ unreadCount: 0 });
  });

  it("creates a new unread row after the earlier one was read", async () => {
    const reader = await newUser("Again");
    await join(community, reader);
    const { events } = await posts.createPost(bob, community, { body: mentioning(reader, "A") });
    await fanOut(events);
    await service.markAllRead(reader);

    await fanOut(events);

    expect(await service.unreadCount(reader)).toBe(1);
  });

  it("rejects a malformed cursor and malformed ids", async () => {
    await expect(service.listNotifications(ada, { cursor: "nope" })).rejects.toBeInstanceOf(
      NotificationValidationError,
    );
    await expect(service.markRead(ada, { ids: ["nope"] })).rejects.toBeInstanceOf(
      NotificationValidationError,
    );
  });

  it("refuses guests", async () => {
    await expect(service.unreadCount({ kind: "guest" })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});
