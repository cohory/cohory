import type { Actor, CommunityRole } from "@cohory/authz";
import {
  addMembership,
  communitySlugSchema,
  createCommunity,
  createDb,
  createPool,
  newId,
  parseAdminDatabaseEnv,
  runInCommunity,
  setRlsFlag,
  withCommunity,
  type CommunityId,
} from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import {
  comments,
  membershipRequests,
  memberships,
  notificationDeliveries,
  notificationPreferences,
  paymentConnections,
  paymentCustomers,
  posts as postsTable,
  subscriptions,
  users,
} from "@cohory/db/schema";
import { createLogMailer } from "@cohory/email";
import { createPostgresPostsRepository, createPostsService } from "@cohory/posts";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createNotificationsFanout } from "../fanout";
import { createMembershipNotifier } from "../membership";
import { createEmailClaims } from "./claims";
import { createNotificationEmailJobs } from "./delivery";
import { immediateHoldMs } from "./plan";

const probeRole = "cohory_notification_content_probe";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const adminPool = createPool(adminUrl);
const adminDb = createDb(adminPool);
const appUrl = new URL(adminUrl);
appUrl.searchParams.set("options", `-c role=${probeRole}`);
const appPool = createPool(appUrl.toString());
const appDb = createDb(appPool);

let clock = new Date("2026-10-18T07:00:00Z").getTime();
const tick = () => new Date((clock += 1000));
const posts = createPostsService({
  repo: createPostgresPostsRepository(appDb),
  storage: {
    put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
    publicUrl: (key) => `/files/${key}`,
  },
  now: tick,
});
const fanOut = createNotificationsFanout({ db: appDb, now: tick });
const notifyMembership = createMembershipNotifier({
  db: appDb,
  appUrl: "http://cohory.test",
  send: async () => undefined,
  now: tick,
});

type UserActor = Actor & { kind: "user" };

function mailerJobs(offsetMs = immediateHoldMs) {
  const mailer = createLogMailer({ log: () => undefined });
  const jobs = createNotificationEmailJobs({
    db: appDb,
    send: (message) => mailer.send(message),
    appUrl: "http://cohory.test",
    secret: "integration-secret-that-is-at-least-32-chars",
    now: () => new Date(clock + offsetMs),
  });
  return { mailer, jobs };
}

async function newUser(name: string): Promise<UserActor> {
  const [row] = await adminDb
    .insert(users)
    .values({ name, email: `content-${newId()}@example.test`, emailVerified: true })
    .returning({ id: users.id });
  if (!row) {
    throw new Error("user insert returned no row");
  }
  return { kind: "user", userId: row.id, platformAdmin: false };
}

async function emailOf(actor: UserActor): Promise<string> {
  const [row] = await adminDb.select().from(users).where(eq(users.id, actor.userId));
  return row?.email ?? "";
}

async function newCommunity(): Promise<{ id: CommunityId; slug: string }> {
  return createCommunity(adminDb, {
    slug: communitySlugSchema.parse(`content-${newId().slice(-12)}`),
    name: "Makers",
  });
}

async function member(communityId: CommunityId, name: string, role: CommunityRole = "member") {
  const actor = await newUser(name);
  await addMembership(withCommunity(adminDb, communityId), {
    userId: actor.userId,
    role,
    status: "active",
    joinedAt: new Date(),
  });
  return actor;
}

async function request(
  communityId: CommunityId,
  requester: UserActor,
  fields: { answer?: string; decisionNote?: string } = {},
): Promise<string> {
  const id = newId();
  await runInCommunity(withCommunity(adminDb, communityId), async ({ tx, values }) => {
    await tx.insert(membershipRequests).values(
      values({
        id,
        userId: requester.userId,
        answers: fields.answer ? [{ question: "Why join?", answer: fields.answer }] : [],
        decisionNote: fields.decisionNote ?? null,
      }),
    );
  });
  return id;
}

async function askToJoin(communityId: CommunityId, requester: UserActor, answer?: string) {
  const requestId = await request(communityId, requester, answer ? { answer } : {});
  await notifyMembership([
    { type: "join_request.created", payload: { communityId, requestId, userId: requester.userId } },
  ]);
}

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

function text(value: string): unknown {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
  };
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
    grant select, insert, update, delete on memberships, membership_requests, posts, post_drafts, agent_identities, post_images, comments, reactions, notifications, outbox, notification_preferences, notification_settings, notification_deliveries, notification_group_sources, post_follows to ${probeRole};
    grant select on subscriptions, payment_connections, payment_customers, comped_memberships, membership_plans to ${probeRole};
  `),
  );
});

afterAll(async () => {
  await appPool.end();
  await adminPool.end();
});

describe("batching right away emails", () => {
  it("waits a few minutes before sending a right away email", async () => {
    const community = await newCommunity();
    const author = await member(community.id, "Ada");
    const bob = await member(community.id, "Bob");
    const { post } = await posts.createPost(bob, community.id, { body: text("Plan") });
    const { comment } = await posts.createComment(bob, community.id, post.id, {
      body: text("Who can help?"),
    });
    const { events } = await posts.createComment(author, community.id, post.id, {
      body: text("I can help"),
      parentId: comment.id,
    });
    await fanOut(events);
    const address = await emailOf(bob);

    const early = mailerJobs(immediateHoldMs - 60_000);
    await early.jobs.sendImmediate();
    expect(early.mailer.sent.map((m) => m.to)).not.toContain(address);

    const later = mailerJobs();
    await later.jobs.sendImmediate();
    expect(later.mailer.sent.map((m) => m.to)).toContain(address);
  });
});

describe("content in notification emails", () => {
  it("quotes the comment, titles the email with the post, and names the action", async () => {
    const community = await newCommunity();
    const author = await member(community.id, "Ada");
    const bob = await member(community.id, "Bob");
    const { post } = await posts.createPost(bob, community.id, {
      title: "Office hours",
      body: text("Plan"),
    });
    const { comment } = await posts.createComment(bob, community.id, post.id, {
      body: text("First"),
    });
    const { events } = await posts.createComment(author, community.id, post.id, {
      body: text("Tuesday works for me"),
      parentId: comment.id,
    });
    await fanOut(events);
    const { mailer, jobs } = mailerJobs();

    await jobs.sendImmediate();

    const address = await emailOf(bob);
    const mail = mailer.sent.find((m) => m.to === address);
    expect(mail?.subject).toBe("[Makers] Office hours");
    expect(mail?.text).toContain("Ada replied to your comment in Makers.");
    expect(mail?.text).toContain('"Tuesday works for me"');
    expect(mail?.html).toContain("Open the comment");
  });

  it("leaves the excerpt and the post title out once the member lost access", async () => {
    const community = await newCommunity();
    const author = await member(community.id, "Ada");
    const dee = await member(community.id, "Dee");
    const { post } = await posts.createPost(dee, community.id, {
      title: "Secret plans",
      body: text("Members only"),
    });
    const { comment } = await posts.createComment(dee, community.id, post.id, {
      body: text("When is it?"),
    });
    const { events } = await posts.createComment(author, community.id, post.id, {
      body: text("The launch date is Friday"),
      parentId: comment.id,
    });
    await fanOut(events);
    await lapsePaidAccess(community.id, dee.userId);
    const { mailer, jobs } = mailerJobs();

    await jobs.sendImmediate();

    const address = await emailOf(dee);
    const mail = mailer.sent.find((m) => m.to === address);
    expect(mail?.subject).toMatch(/^\[Makers\] New activity on a post \([0-9a-f]{4}\)$/);
    expect(`${mail?.text}\n${mail?.html}`).not.toMatch(/Secret plans|Friday/);
  });
});

async function replyOnTitledPost(title: string, reply: string) {
  const community = await newCommunity();
  const author = await member(community.id, "Ada");
  const bob = await member(community.id, "Bob");
  const { post } = await posts.createPost(bob, community.id, { title, body: text("Plan") });
  const { comment } = await posts.createComment(bob, community.id, post.id, {
    body: text("First"),
  });
  const { comment: answer, events } = await posts.createComment(author, community.id, post.id, {
    body: text(reply),
    parentId: comment.id,
  });
  await fanOut(events);
  return { community, bob, postId: post.id, replyId: answer.id };
}

describe("removed content", () => {
  it("drops the quote of a comment removed before the email goes out", async () => {
    const { bob, replyId } = await replyOnTitledPost("Office hours", "Call me at 555 0100");
    await adminDb.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, replyId));
    const { mailer, jobs } = mailerJobs();

    await jobs.sendImmediate();

    const address = await emailOf(bob);
    const mail = mailer.sent.find((m) => m.to === address);
    expect(mail?.text).toContain("Ada replied to your comment");
    expect(`${mail?.text}\n${mail?.html}`).not.toContain("555 0100");
  });

  it("drops the quote and the title of a post removed before the email goes out", async () => {
    const { bob, postId } = await replyOnTitledPost("Leaked plans", "The launch is Friday");
    await adminDb
      .update(postsTable)
      .set({ deletedAt: new Date() })
      .where(eq(postsTable.id, postId));
    const { mailer, jobs } = mailerJobs();

    await jobs.sendImmediate();

    const address = await emailOf(bob);
    const mail = mailer.sent.find((m) => m.to === address);
    expect(mail).toBeDefined();
    expect(`${mail?.subject}\n${mail?.text}\n${mail?.html}`).not.toMatch(/Leaked plans|Friday/);
  });
});

describe("join request emails", () => {
  it("sends nothing to a moderator who lost the approve permission before the email went out", async () => {
    const community = await newCommunity();
    const moderator = await member(community.id, "Max", "moderator");
    await adminDb.insert(notificationPreferences).values({
      userId: moderator.userId,
      type: "join_request",
      inApp: true,
      email: "immediate",
    });
    await askToJoin(community.id, await newUser("Ivy"), "Let me in");
    await adminDb
      .update(memberships)
      .set({ role: "member" })
      .where(
        and(eq(memberships.communityId, community.id), eq(memberships.userId, moderator.userId)),
      );
    const { mailer, jobs } = mailerJobs();

    await jobs.sendImmediate();

    const address = await emailOf(moderator);
    expect(mailer.sent.map((m) => m.to)).not.toContain(address);
    const rows = await adminDb
      .select({ outcome: notificationDeliveries.outcome })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.userId, moderator.userId));
    expect(rows.map((row) => row.outcome)).toEqual(["skipped"]);
  });

  it("emails the owner right away with the answer and leaves admins for the daily summary", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "Olga", "owner");
    const admin = await member(community.id, "Ari", "admin");
    await askToJoin(community.id, await newUser("Ivy"), "I run a pottery studio");
    const { mailer, jobs } = mailerJobs();

    await jobs.sendImmediate();

    const ownerAddress = await emailOf(owner);
    const adminAddress = await emailOf(admin);
    const mail = mailer.sent.find((m) => m.to === ownerAddress);
    expect(mail?.subject).toBe("[Makers] Ivy asked to join");
    expect(mail?.text).toContain("Ivy asked to join Makers.");
    expect(mail?.text).toContain('"I run a pottery studio"');
    expect(mail?.html).toContain("Review the request");
    expect(mailer.sent.map((m) => m.to)).not.toContain(adminAddress);
  });

  it("merges requests that arrive together into one email", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "Olga", "owner");
    await askToJoin(community.id, await newUser("Ivy"));
    await askToJoin(community.id, await newUser("Jon"));
    await askToJoin(community.id, await newUser('=HYPERLINK("http://x")'));
    const { mailer, jobs } = mailerJobs();

    await jobs.sendImmediate();

    const address = await emailOf(owner);
    const toOwner = mailer.sent.filter((m) => m.to === address);
    expect(toOwner).toHaveLength(1);
    expect(toOwner[0]?.subject).toBe("[Makers] 3 people asked to join");
    expect(toOwner[0]?.text).toContain("Someone asked to join Makers.");
    expect(toOwner[0]?.text).not.toContain("HYPERLINK");
    expect(toOwner[0]?.html).toContain("Review the requests");
  });

  it("passes on the decision note with the approval", async () => {
    const community = await newCommunity();
    const admin = await member(community.id, "Ari", "admin");
    const joiner = await member(community.id, "Rev Joiner18");
    const requestId = await request(community.id, joiner, {
      decisionNote: "Welcome in. Start with the pinned post.",
    });
    await notifyMembership([
      {
        type: "join_request.decided",
        payload: {
          communityId: community.id,
          requestId,
          userId: joiner.userId,
          decidedBy: admin.userId,
          status: "approved",
        },
      },
    ]);
    const { mailer, jobs } = mailerJobs();

    await jobs.sendImmediate();

    const address = await emailOf(joiner);
    const approved = mailer.sent.find((m) => m.to === address);
    expect(approved?.text).toContain("Hi Rev Joiner18,");
    expect(approved?.text).toContain("Your request to join Makers was approved.");
    expect(approved?.text).toContain('"Welcome in. Start with the pinned post."');
    expect(approved?.html).toContain("Open Makers");
  });
});

describe("the right away scan", () => {
  const claims = createEmailClaims(appDb);
  const minutes = (count: number) => count * 60_000;

  it("leaves join requests deferred to the daily summary out once they are past the hold", async () => {
    clock = new Date("2027-03-01T07:00:00Z").getTime();
    const community = await newCommunity();
    const admin = await member(community.id, "Ari", "admin");
    await askToJoin(community.id, await newUser("Ivy"));
    const asked = clock;

    expect(await claims.scan("immediate", new Date(asked + minutes(4)))).toContain(admin.userId);
    expect(await claims.scan("immediate", new Date(asked + minutes(30)))).not.toContain(
      admin.userId,
    );
  });

  it("scans the people with the oldest pending email first", async () => {
    clock = new Date("2027-04-01T07:00:00Z").getTime();
    const community = await newCommunity();
    const author = await member(community.id, "Ada");
    const first = await member(community.id, "Bob");
    const second = await member(community.id, "Cy");
    for (const target of [first, second]) {
      const { post } = await posts.createPost(target, community.id, { body: text("Plan") });
      const { comment } = await posts.createComment(target, community.id, post.id, {
        body: text("Mine"),
      });
      const { events } = await posts.createComment(author, community.id, post.id, {
        body: text("Reply"),
        parentId: comment.id,
      });
      await fanOut(events);
      clock += minutes(1);
    }

    expect(await claims.scan("immediate", new Date(clock + minutes(10)), 1)).toEqual([
      first.userId,
    ]);
  });
});
