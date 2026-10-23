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
import { notificationDeliveries, users } from "@cohory/db/schema";
import {
  createLogMailer,
  createMemorySuppressionList,
  hashEmailAddress,
  withSuppression,
  type EmailMessage,
} from "@cohory/email";
import { createPostgresPostsRepository, createPostsService } from "@cohory/posts";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createNotificationsFanout } from "../fanout";
import { createPreferencesService } from "../preferences-service";
import { createNotificationsService } from "../service";
import { createNotificationEmailJobs } from "./delivery";
import { immediateHoldMs } from "./plan";

const probeRole = "cohory_notification_email_probe";
const secret = "integration-secret-that-is-at-least-32-chars";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const adminPool = createPool(adminUrl);
const adminDb = createDb(adminPool);
const appUrl = new URL(adminUrl);
appUrl.searchParams.set("options", `-c role=${probeRole}`);
const appPool = createPool(appUrl.toString());
const appDb = createDb(appPool);

let clock = new Date("2026-10-18T07:00:00Z").getTime();
const tick = () => new Date((clock += 1000));
const afterHold = () => new Date(clock + immediateHoldMs);
const posts = createPostsService({
  repo: createPostgresPostsRepository(appDb),
  storage: {
    put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
    publicUrl: (key) => `/files/${key}`,
  },
  now: tick,
});
const fanOut = createNotificationsFanout({ db: appDb, now: tick });
const inApp = createNotificationsService({ db: appDb, now: tick });
const preferences = createPreferencesService({ db: appDb, secret, now: tick });

type UserActor = Actor & { kind: "user" };

function mailerJobs(send?: (message: EmailMessage) => Promise<void>) {
  const mailer = createLogMailer({ log: () => undefined });
  const jobs = createNotificationEmailJobs({
    db: appDb,
    send: send ?? ((message) => mailer.send(message)),
    appUrl: "http://cohory.test",
    secret,
    now: afterHold,
  });
  return { mailer, jobs };
}

async function newUser(name: string, emailVerified = true): Promise<UserActor> {
  const [row] = await adminDb
    .insert(users)
    .values({ name, email: `email-${newId()}@example.test`, emailVerified })
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

function mentioning(user: UserActor): unknown {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Hi " },
          { type: "mention", attrs: { id: user.userId, label: "x" } },
        ],
      },
    ],
  };
}

const plain = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
};

let community: CommunityId;
let author: UserActor;

async function member(name: string, emailVerified = true): Promise<UserActor> {
  const actor = await newUser(name, emailVerified);
  await addMembership(withCommunity(adminDb, community), {
    userId: actor.userId,
    role: "member",
    status: "active",
    joinedAt: new Date(),
  });
  return actor;
}

async function mention(target: UserActor): Promise<void> {
  const { events } = await posts.createPost(author, community, { body: mentioning(target) });
  await fanOut(events);
}

async function commentOnPostOf(owner: UserActor): Promise<void> {
  const { post } = await posts.createPost(owner, community, { body: plain });
  const { events } = await posts.createComment(author, community, post.id, { body: plain });
  await fanOut(events);
}

async function deliveriesOf(actor: UserActor) {
  return adminDb
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.userId, actor.userId));
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
    grant select, insert, update, delete on memberships, posts, post_drafts, agent_identities, post_images, comments, reactions, notifications, outbox, notification_preferences, notification_settings, notification_deliveries, notification_group_sources, post_follows to ${probeRole};
    grant select on subscriptions, payment_connections, comped_memberships, membership_plans to ${probeRole};
  `),
  );
  const created = await createCommunity(adminDb, {
    slug: communitySlugSchema.parse(`mail-${newId().slice(-12)}`),
    name: "Makers",
  });
  community = created.id;
  author = await member("Ada");
});

afterAll(async () => {
  await appPool.end();
  await adminPool.end();
});

describe("immediate notification email", () => {
  it("sends one email per mention with a post link, an unsubscribe link, and list headers", async () => {
    const bob = await member("Bob");
    await mention(bob);
    const { mailer, jobs } = mailerJobs();

    const result = await jobs.sendImmediate();

    const address = await emailOf(bob);
    const toBob = mailer.sent.filter((message) => message.to === address);
    expect(toBob.map((message) => message.subject)).toEqual([
      expect.stringMatching(/^\[Makers\] New activity on a post \([0-9a-f]{4}\)$/),
    ]);
    expect(toBob[0]?.text).toContain("http://cohory.test/c/");
    expect(toBob[0]?.text).toContain("http://cohory.test/unsubscribe?token=");
    expect(toBob[0]?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect((await deliveriesOf(bob)).map((row) => row.outcome)).toEqual(["sent"]);
  });

  it("merges the updates on one post into one threaded email titled by the post", async () => {
    const gil = await member("Gil");
    await preferences.updatePreferences(gil, {
      types: [{ type: "comment_on_post", inApp: true, email: "immediate" }],
    });
    const { post } = await posts.createPost(gil, community, {
      title: "Office hours",
      body: plain,
    });
    for (let i = 0; i < 2; i += 1) {
      const { events } = await posts.createComment(author, community, post.id, { body: plain });
      await fanOut(events);
    }
    const { mailer, jobs } = mailerJobs();

    await jobs.sendImmediate();

    const address = await emailOf(gil);
    const toGil = mailer.sent.filter((message) => message.to === address);
    expect(toGil).toHaveLength(1);
    expect(toGil[0]?.subject).toBe("[Makers] Office hours");
    expect(toGil[0]?.text).toContain('2 updates on "Office hours"');
    expect(toGil[0]?.text.match(/Ada commented on your post in Makers\./g)).toHaveLength(2);
    expect(toGil[0]?.text).toContain('"Hello"');
    for (const message of toGil) {
      expect(message.communityId).toBe(community);
      expect(message.headers).toMatchObject({
        References: `<post-${post.id}@cohory.test>`,
        "In-Reply-To": `<post-${post.id}@cohory.test>`,
        "List-Id": expect.stringMatching(/^"Makers" <mail-[a-z0-9-]+\.cohory\.test>$/),
      });
    }
  });

  it("skips a member who opted out of email about the community", async () => {
    const hal = await member("Hal");
    await mention(hal);
    const address = await emailOf(hal);
    const list = createMemorySuppressionList();
    await list.suppress({
      addressHash: hashEmailAddress(address),
      communityId: community,
      reason: "opt_out",
      source: "member",
    });
    const driver = createLogMailer({ log: () => undefined });
    const mailer = withSuppression(driver, { list, log: { record: async () => undefined } });
    const { jobs } = mailerJobs((message) => mailer.send(message));

    await jobs.sendImmediate();

    expect(driver.sent.map((m) => m.to)).not.toContain(address);
    expect((await deliveriesOf(hal)).map((row) => row.outcome)).toEqual(["sent"]);
  });

  it("does not send twice when the job runs again", async () => {
    const cy = await member("Cy");
    await mention(cy);
    const { mailer, jobs } = mailerJobs();
    const address = await emailOf(cy);

    await jobs.sendImmediate();
    await jobs.sendImmediate();
    await Promise.all([jobs.sendImmediate(), jobs.sendImmediate()]);

    expect(mailer.sent.filter((message) => message.to === address)).toHaveLength(1);
  });

  it("records a skip and sends nothing when email for the type is off", async () => {
    const dee = await member("Dee");
    await preferences.updatePreferences(dee, {
      types: [{ type: "mention", inApp: true, email: "off" }],
    });
    await mention(dee);
    const { mailer, jobs } = mailerJobs();

    await jobs.sendImmediate();

    expect(mailer.sent.map((m) => m.to)).not.toContain(await emailOf(dee));
    expect((await deliveriesOf(dee)).map((row) => row.outcome)).toEqual(["skipped"]);
  });

  it("skips a notification the member already read in the app", async () => {
    const eve = await member("Eve");
    await mention(eve);
    await inApp.markAllRead(eve);
    const { mailer, jobs } = mailerJobs();

    await jobs.sendImmediate();

    expect(mailer.sent.map((m) => m.to)).not.toContain(await emailOf(eve));
    expect((await deliveriesOf(eve)).map((row) => row.outcome)).toEqual(["skipped"]);
  });

  it("releases the claim when sending fails so the next run retries", async () => {
    const fay = await member("Fay");
    await mention(fay);
    const address = await emailOf(fay);
    const failing = mailerJobs(async (message) => {
      if (message.to === address) {
        throw new Error("smtp down");
      }
    });

    const failed = await failing.jobs.sendImmediate();
    expect(failed.failed).toBeGreaterThanOrEqual(1);
    expect(await deliveriesOf(fay)).toEqual([]);

    const { mailer, jobs } = mailerJobs();
    await jobs.sendImmediate();
    expect(mailer.sent.filter((m) => m.to === address)).toHaveLength(1);
  });
});

describe("daily digest", () => {
  it("leaves daily notifications for the digest and batches them at the chosen hour", async () => {
    const gus = await member("Gus");
    await preferences.updatePreferences(gus, { digestHour: 9, timeZone: "Europe/Berlin" });
    await commentOnPostOf(gus);
    await commentOnPostOf(gus);
    const address = await emailOf(gus);
    const { mailer, jobs } = mailerJobs();

    await jobs.sendImmediate();
    clock = new Date("2026-10-18T05:30:00Z").getTime();
    await jobs.sendDigests();
    expect(mailer.sent.filter((m) => m.to === address)).toEqual([]);

    clock = new Date("2026-10-18T07:10:00Z").getTime();
    await jobs.sendDigests();
    await jobs.sendDigests();

    const digests = mailer.sent.filter((m) => m.to === address);
    expect(digests).toHaveLength(1);
    expect(digests[0]?.subject).toBe("Ada commented on your posts");
    expect(digests[0]?.text).toContain("Makers\n");
    expect(digests[0]?.text.match(/Ada commented on your post\n/g)).toHaveLength(2);
    expect((await deliveriesOf(gus)).map((row) => row.outcome)).toEqual(["sent", "sent"]);
  });
});

describe("unverified email addresses", () => {
  it("sends no notification email to an unverified address and records a skip", async () => {
    const hal = await member("Hal", false);
    await mention(hal);
    const { mailer, jobs } = mailerJobs();

    await jobs.sendImmediate();

    expect(mailer.sent.map((m) => m.to)).not.toContain(await emailOf(hal));
    expect((await deliveriesOf(hal)).map((row) => row.outcome)).toEqual(["skipped"]);
  });

  it("sends no daily digest to an unverified address", async () => {
    const ida = await member("Ida", false);
    await preferences.updatePreferences(ida, { digestHour: 9, timeZone: "Europe/Berlin" });
    await commentOnPostOf(ida);
    const { mailer, jobs } = mailerJobs();

    clock = new Date("2026-10-19T07:10:00Z").getTime();
    await jobs.sendDigests();

    expect(mailer.sent.map((m) => m.to)).not.toContain(await emailOf(ida));
    expect((await deliveriesOf(ida)).map((row) => row.outcome)).toEqual(["skipped"]);
  });

  it("emails new notifications once the address is verified", async () => {
    const jo = await member("Jo", false);
    await adminDb.update(users).set({ emailVerified: true }).where(eq(users.id, jo.userId));
    await mention(jo);
    const { mailer, jobs } = mailerJobs();

    await jobs.sendImmediate();

    expect(mailer.sent.map((m) => m.to)).toContain(await emailOf(jo));
  });
});
