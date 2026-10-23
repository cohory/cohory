import type { CommunityRole } from "@cohory/authz";
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
  notifications,
  notificationSettings,
  paymentConnections,
  paymentCustomers,
  subscriptions,
  users,
} from "@cohory/db/schema";
import type { EmailMessage } from "@cohory/email";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DigestFeed, WeeklyDigestSource } from "./compose";
import { createWeeklyDigestJob } from "./job";

const probeRole = "cohory_weekly_digest_probe";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const adminPool = createPool(adminUrl);
const adminDb = createDb(adminPool);
const appUrl = new URL(adminUrl);
appUrl.searchParams.set("options", `-c role=${probeRole}`);
const appPool = createPool(appUrl.toString());
const appDb = createDb(appPool);
const secret = "weekly-digest-test-secret-at-least-32-chars";

const timeZone = "Asia/Kathmandu";
const digestHour = 3;
let week = 0;
const mondayAt = () => new Date(Date.parse("2026-10-25T21:30:00Z") + week * 7 * 86_400_000);

const busy: DigestFeed = {
  newPostCount: 4,
  topPosts: [{ id: newId(), title: "Show your workbench", excerpt: "Hello", commentCount: 3 }],
};
const quiet: DigestFeed = { newPostCount: 1, topPosts: [] };
const feeds = new Map<string, DigestFeed | null>();
const feedReads: { communityId: string; userId: string }[] = [];
const source: WeeklyDigestSource = {
  feed: async ({ communityId, userId }) => {
    feedReads.push({ communityId, userId });
    const feed = feeds.get(communityId);
    return feed === undefined ? quiet : feed;
  },
  extras: async () => ({ events: [], progress: null }),
};

function job(send: (message: EmailMessage) => Promise<void>) {
  return createWeeklyDigestJob({
    db: appDb,
    source,
    send,
    appUrl: "https://cohory.test",
    secret,
    now: mondayAt,
  });
}

function outbox() {
  const sent: EmailMessage[] = [];
  return { sent, send: async (message: EmailMessage) => void sent.push(message) };
}

async function newUser(name: string, weeklyDigest = true): Promise<string> {
  const [row] = await adminDb
    .insert(users)
    .values({ name, email: `weekly-${newId()}@example.test`, emailVerified: true })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert returned no row");
  await adminDb
    .insert(notificationSettings)
    .values({ userId: row.id, digestHour, timeZone, weeklyDigest });
  return row.id;
}

async function join(communityId: CommunityId, userId: string, role: CommunityRole = "member") {
  await addMembership(withCommunity(adminDb, communityId), {
    userId,
    role,
    status: "active",
    joinedAt: new Date(mondayAt().getTime() - 86_400_000),
  });
}

async function community(name: string, posts: DigestFeed | null) {
  const created = await createCommunity(adminDb, {
    slug: communitySlugSchema.parse(`weekly-${newId().slice(-8)}`),
    name,
  });
  feeds.set(created.id, posts);
  return created;
}

async function lapsePaidAccess(communityId: CommunityId, userId: string): Promise<void> {
  const ended = new Date("2026-10-01T00:00:00Z");
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

function emailFor(sent: readonly EmailMessage[], name: string): EmailMessage | undefined {
  return sent.find((message) => message.text.includes(`Hi ${name},`));
}

async function lastSent(userId: string): Promise<Date | null> {
  const [row] = await adminDb
    .select({ at: notificationSettings.lastWeeklyDigestAt })
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, userId));
  return row?.at ?? null;
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
    grant select on memberships, notifications to ${probeRole};
    grant select on subscriptions, payment_connections, payment_customers, comped_memberships, membership_plans to ${probeRole};
    grant select, insert, update on notification_settings to ${probeRole};
  `),
  );
});

afterAll(async () => {
  await appPool.end();
  await adminPool.end();
});

describe("weekly digest", () => {
  it("sends one combined email for the busy communities and skips quiet ones", async () => {
    week += 1;
    const ada = await newUser("Ada");
    const makers = await community("Makers", busy);
    const gardeners = await community("Gardeners", busy);
    const readers = await community("Readers", quiet);
    for (const c of [makers, gardeners, readers]) await join(c.id, ada);
    await join(makers.id, await newUser("Jamie"));
    const mail = outbox();

    const result = await job(mail.send).sendWeeklyDigests();

    expect(result.failed).toBe(0);
    const [email] = mail.sent.filter((message) => message.text.includes("Hi Ada,"));
    expect(email?.subject).toBe("This week in your communities");
    expect(email?.text).toContain("Gardeners");
    expect(email?.text).not.toContain("Readers");
    expect(email?.text).toContain("New members: Jamie.");
    expect(email?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(await lastSent(ada)).toEqual(mondayAt());
  });

  it("skips a community the member lost paid access to and still sends the others", async () => {
    week += 1;
    const gus = await newUser("Gus");
    const makers = await community("Makers", busy);
    const club = await community("Paid club", busy);
    await join(makers.id, gus);
    await join(club.id, gus);
    await lapsePaidAccess(club.id, gus);
    const mail = outbox();

    const result = await job(mail.send).sendWeeklyDigests();

    expect(result.failed).toBe(0);
    const email = emailFor(mail.sent, "Gus");
    expect(email?.text).toContain("Makers");
    expect(email?.text).not.toContain("Paid club");
    expect(feedReads).not.toContainEqual({ communityId: club.id, userId: gus });
    expect(await lastSent(gus)).toEqual(mondayAt());
  });

  it("skips a community whose feed the member cannot read and still sends the others", async () => {
    week += 1;
    const hal = await newUser("Hal");
    const makers = await community("Makers", busy);
    const closed = await community("Closed circle", null);
    await join(makers.id, hal);
    await join(closed.id, hal);
    const mail = outbox();

    const result = await job(mail.send).sendWeeklyDigests();

    expect(result.failed).toBe(0);
    const email = emailFor(mail.sent, "Hal");
    expect(email?.text).toContain("Makers");
    expect(email?.text).not.toContain("Closed circle");
  });

  it("reads a community's feed once per run for members with the same role", async () => {
    week += 1;
    const ivy = await newUser("Ivy");
    const jon = await newUser("Jon");
    const makers = await community("Makers", busy);
    await join(makers.id, ivy);
    await join(makers.id, jon);
    const mail = outbox();

    await job(mail.send).sendWeeklyDigests();

    expect(feedReads.filter((read) => read.communityId === makers.id)).toHaveLength(1);
    expect(emailFor(mail.sent, "Ivy")?.text).toContain("Show your workbench");
    expect(emailFor(mail.sent, "Jon")?.text).toContain("Show your workbench");
  });

  it("leaves the reader out of the new members line", async () => {
    week += 1;
    const kim = await newUser("Kim");
    const lou = await newUser("Lou");
    const makers = await community("Makers", busy);
    await join(makers.id, kim);
    await join(makers.id, lou);
    const mail = outbox();

    await job(mail.send).sendWeeklyDigests();

    expect(emailFor(mail.sent, "Kim")?.text).toContain("New members: Lou.");
    expect(emailFor(mail.sent, "Lou")?.text).toContain("New members: Kim.");
  });

  it("does not send twice when the job runs again in the same hour", async () => {
    week += 1;
    const bo = await newUser("Bo");
    const makers = await community("Makers", busy);
    await join(makers.id, bo);
    const mail = outbox();

    await job(mail.send).sendWeeklyDigests();
    await job(mail.send).sendWeeklyDigests();

    expect(mail.sent.filter((message) => message.text.includes("Hi Bo,"))).toHaveLength(1);
  });

  it("keeps the digest due when sending fails and sends it on the next run", async () => {
    week += 1;
    const cy = await newUser("Cy");
    const makers = await community("Makers", busy);
    await join(makers.id, cy);

    const failing = await job(async (message) => {
      if (message.text.includes("Hi Cy,")) throw new Error("smtp down");
    }).sendWeeklyDigests();
    expect(failing.failed).toBeGreaterThanOrEqual(1);
    expect(await lastSent(cy)).toBeNull();

    const mail = outbox();
    await job(mail.send).sendWeeklyDigests();
    expect(mail.sent.filter((message) => message.text.includes("Hi Cy,"))).toHaveLength(1);
  });

  it("sends nothing to members who turned the weekly digest off", async () => {
    week += 1;
    const di = await newUser("Di", false);
    const makers = await community("Makers", busy);
    await join(makers.id, di);
    const mail = outbox();

    await job(mail.send).sendWeeklyDigests();

    expect(mail.sent.filter((message) => message.text.includes("Hi Di,"))).toEqual([]);
  });

  it("adds the paid membership line for the owner of a single community", async () => {
    week += 1;
    const ed = await newUser("Ed");
    const fay = await newUser("Fay");
    const makers = await community("Makers", busy);
    await join(makers.id, ed, "owner");
    await join(makers.id, fay);
    await adminDb.insert(notifications).values({
      communityId: makers.id,
      userId: ed,
      actorId: fay,
      type: "paid_member_joined",
      subjectType: "community",
      subjectId: makers.id,
      createdAt: new Date(mondayAt().getTime() - 3_600_000),
    });
    const mail = outbox();

    await job(mail.send).sendWeeklyDigests();

    const [email] = mail.sent.filter((message) => message.text.includes("Hi Ed,"));
    expect(email?.subject).toBe("[Makers] This week: Show your workbench");
    expect(email?.text).toContain("Paid memberships this week: 1 new paying member.");
    const [member] = mail.sent.filter((message) => message.text.includes("Hi Fay,"));
    expect(member?.text).not.toContain("Paid memberships");
  });
});
