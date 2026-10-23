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
import { paymentConnections, paymentCustomers, subscriptions, users } from "@cohory/db/schema";
import {
  createLogMailer,
  createMemorySuppressionList,
  hashEmailAddress,
  withSuppression,
  type EmailMessage,
} from "@cohory/email";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMemberEmailJob } from "./member-email-job";
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

const service = createPostsService({
  repo: createPostgresPostsRepository(adminDb),
  storage: {
    put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
    publicUrl: (key) => `/files/${key}`,
  },
});

type UserActor = Actor & { kind: "user" };

async function person(
  communityId: CommunityId | null,
  options: { role?: CommunityRole; status?: "active" | "banned"; verified?: boolean } = {},
): Promise<UserActor & { email: string }> {
  const email = `announce-${newId()}@example.test`;
  const [row] = await adminDb
    .insert(users)
    .values({ name: "Person", email, emailVerified: options.verified ?? true })
    .returning({ id: users.id });
  if (!row) {
    throw new Error("user insert returned no row");
  }
  if (communityId) {
    await addMembership(withCommunity(adminDb, communityId), {
      userId: row.id,
      role: options.role ?? "member",
      status: options.status ?? "active",
      joinedAt: new Date(),
    });
  }
  return { kind: "user", userId: row.id, platformAdmin: false, email };
}

async function newCommunity(): Promise<CommunityId> {
  const community = await createCommunity(adminDb, {
    slug: communitySlugSchema.parse(`announce-${newId().slice(-12)}`),
    name: "Design Club",
    privacy: "private",
  });
  return community.id;
}

function body(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function job(
  sent: EmailMessage[],
  fail: ReadonlySet<string> = new Set(),
  send?: (message: EmailMessage) => Promise<void>,
) {
  return createMemberEmailJob({
    db: appDb,
    appUrl: "https://community.example.com/",
    pageSize: 2,
    optOut: ({ to }) => ({
      url: `https://community.example.com/email-opt-out?for=${to}`,
      headers: { "List-Unsubscribe": "<https://community.example.com/api/email-opt-out>" },
    }),
    send:
      send ??
      (async (message) => {
        if (fail.has(message.to)) {
          throw new Error("smtp down");
        }
        sent.push(message);
      }),
  });
}

async function endPaidAccess(communityId: CommunityId, userId: string) {
  const ended = new Date(Date.now() - 86_400_000);
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

describe("member email job", () => {
  it("emails every active, verified member of the community except the sender", async () => {
    const community = await newCommunity();
    const other = await newCommunity();
    const owner = await person(community, { role: "owner" });
    const members = [await person(community), await person(community), await person(community)];
    await person(community, { status: "banned" });
    await person(community, { verified: false });
    await person(other);
    const { post } = await service.createPost(owner, community, {
      title: "Live call on Friday",
      body: body("We meet at 17:00."),
    });
    const sent: EmailMessage[] = [];

    const result = await job(sent)({
      communityId: community,
      postId: post.id,
      sentBy: owner.userId,
      occurredAt: new Date().toISOString(),
    });

    expect(result).toEqual({ sent: 3, failed: 0, skipped: false, stopped: false });
    expect(sent.map((m) => m.to).sort()).toEqual(members.map((m) => m.email).sort());
    expect(sent[0]).toMatchObject({
      communityId: community,
      template: "member-announcement",
      subject: "[Design Club] Live call on Friday",
      headers: { "List-Unsubscribe": "<https://community.example.com/api/email-opt-out>" },
    });
    expect(sent[0]?.html).toContain(`/posts/${post.id}`);
  });

  it("stops between recipients when the job is aborted and says so", async () => {
    const community = await newCommunity();
    const owner = await person(community, { role: "owner" });
    await person(community);
    await person(community);
    await person(community);
    const { post } = await service.createPost(owner, community, { body: body("Hello") });
    const controller = new AbortController();
    const sent: EmailMessage[] = [];

    const result = await job([], new Set(), async (message) => {
      sent.push(message);
      controller.abort();
    })(
      {
        communityId: community,
        postId: post.id,
        sentBy: owner.userId,
        occurredAt: new Date().toISOString(),
      },
      { signal: controller.signal },
    );

    expect(result).toEqual({ sent: 1, failed: 0, skipped: false, stopped: true });
    expect(sent).toHaveLength(1);
  });

  it("keeps going when one address fails and counts it", async () => {
    const community = await newCommunity();
    const owner = await person(community, { role: "owner" });
    const broken = await person(community);
    await person(community);
    const { post } = await service.createPost(owner, community, { body: body("Hi") });
    const sent: EmailMessage[] = [];

    const result = await job(
      sent,
      new Set([broken.email]),
    )({
      communityId: community,
      postId: post.id,
      sentBy: owner.userId,
      occurredAt: new Date().toISOString(),
    });

    expect(result).toEqual({ sent: 1, failed: 1, skipped: false, stopped: false });
  });

  it("skips a member whose paid access ended", async () => {
    const community = await newCommunity();
    const owner = await person(community, { role: "owner" });
    const paying = await person(community);
    const lapsed = await person(community);
    await endPaidAccess(community, lapsed.userId);
    const { post } = await service.createPost(owner, community, { body: body("Members only") });
    const sent: EmailMessage[] = [];

    const result = await job(sent)({
      communityId: community,
      postId: post.id,
      sentBy: owner.userId,
      occurredAt: new Date().toISOString(),
    });

    expect(result).toEqual({ sent: 1, failed: 0, skipped: false, stopped: false });
    expect(sent.map((m) => m.to)).toEqual([paying.email]);
  });

  it("does not deliver to an address suppressed for the community or everywhere", async () => {
    const community = await newCommunity();
    const owner = await person(community, { role: "owner" });
    const reader = await person(community);
    const optedOut = await person(community);
    const bounced = await person(community);
    const list = createMemorySuppressionList();
    await list.suppress({
      addressHash: hashEmailAddress(optedOut.email),
      communityId: community,
      reason: "opt_out",
      source: "member",
    });
    await list.suppress({
      addressHash: hashEmailAddress(bounced.email),
      communityId: null,
      reason: "hard_bounce",
      source: "smtp",
    });
    const mailer = createLogMailer({ log: () => undefined });
    const guarded = withSuppression(mailer, { list, log: { record: async () => undefined } });
    const { post } = await service.createPost(owner, community, { body: body("News") });

    await job([], new Set(), (message) => guarded.send(message))({
      communityId: community,
      postId: post.id,
      sentBy: owner.userId,
      occurredAt: new Date().toISOString(),
    });

    expect(mailer.sent.map((m) => m.to)).toEqual([reader.email]);
  });

  it("sends nothing when the post was deleted before the job ran", async () => {
    const community = await newCommunity();
    const owner = await person(community, { role: "owner" });
    await person(community);
    const { post } = await service.createPost(owner, community, { body: body("Oops") });
    await service.deletePost(owner, community, post.id);
    const sent: EmailMessage[] = [];

    const result = await job(sent)({
      communityId: community,
      postId: post.id,
      sentBy: owner.userId,
      occurredAt: new Date().toISOString(),
    });

    expect(result).toEqual({ sent: 0, failed: 0, skipped: true, stopped: false });
    expect(sent).toEqual([]);
  });

  it("does not find a post through another community", async () => {
    const community = await newCommunity();
    const other = await newCommunity();
    const owner = await person(community, { role: "owner" });
    await person(other);
    const { post } = await service.createPost(owner, community, { body: body("Mine") });
    const sent: EmailMessage[] = [];

    const result = await job(sent)({
      communityId: other,
      postId: post.id,
      sentBy: owner.userId,
      occurredAt: new Date().toISOString(),
    });

    expect(result.skipped).toBe(true);
    expect(sent).toEqual([]);
  });
});
