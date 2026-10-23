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
import { users } from "@cohory/db/schema";
import { createLogMailer, type EmailMessage } from "@cohory/email";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createNotificationEmailJobs } from "./email/delivery";
import { immediateHoldMs } from "./email/plan";
import { createMembershipNotifier } from "./membership";
import { createNotificationsService } from "./service";

const probeRole = "cohory_membership_notify_probe";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const adminPool = createPool(adminUrl);
const adminDb = createDb(adminPool);
const appUrl = new URL(adminUrl);
appUrl.searchParams.set("options", `-c role=${probeRole}`);
const appPool = createPool(appUrl.toString());
const appDb = createDb(appPool);

let clock = new Date("2026-10-18T07:00:00Z").getTime();
const now = () => new Date(clock);
const sent: EmailMessage[] = [];
let failNextSend = false;
const notify = createMembershipNotifier({
  db: appDb,
  now,
  appUrl: "http://cohory.test",
  send: async (message) => {
    if (failNextSend) {
      failNextSend = false;
      throw new Error("smtp down");
    }
    sent.push(message);
  },
});
const inApp = createNotificationsService({ db: appDb, now });

type UserActor = Actor & { kind: "user" };

async function newUser(name: string): Promise<UserActor> {
  const [row] = await adminDb
    .insert(users)
    .values({ name, email: `membership-${newId()}@example.test`, emailVerified: true })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert returned no row");
  return { kind: "user", userId: row.id, platformAdmin: false };
}

async function emailOf(actor: UserActor): Promise<string> {
  const [row] = await adminDb.select().from(users).where(eq(users.id, actor.userId));
  return row?.email ?? "";
}

async function member(communityId: CommunityId, name: string, role: CommunityRole) {
  const actor = await newUser(name);
  await addMembership(withCommunity(adminDb, communityId), {
    userId: actor.userId,
    role,
    status: "active",
    joinedAt: new Date(),
  });
  return actor;
}

async function newCommunity(slug: string) {
  const created = await createCommunity(adminDb, {
    slug: communitySlugSchema.parse(`${slug}-${newId().slice(-8)}`),
    name: "Potters",
  });
  return created;
}

function mailer() {
  const log = createLogMailer({ log: () => undefined });
  const jobs = createNotificationEmailJobs({
    db: appDb,
    send: (message) => log.send(message),
    appUrl: "http://cohory.test",
    secret: "integration-secret-that-is-at-least-32-chars",
    now: () => new Date(clock + immediateHoldMs),
  });
  return { log, jobs };
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
    grant select, insert, update, delete on memberships, membership_requests, outbox, notifications, notification_preferences, notification_settings, notification_deliveries to ${probeRole};
  `),
  );
});

afterAll(async () => {
  await appPool.end();
  await adminPool.end();
});

describe("membership request notifications", () => {
  it("tells moderators, admins, and the owner in the app and emails only the owner right away", async () => {
    const community = await newCommunity("potters");
    const owner = await member(community.id, "Olga", "owner");
    const moderator = await member(community.id, "Max", "moderator");
    const regular = await member(community.id, "Rae", "member");
    const requester = await newUser("Ivy");
    const requestId = newId();

    const result = await notify([
      {
        type: "join_request.created",
        payload: { communityId: community.id, requestId, userId: requester.userId },
      },
    ]);

    expect(result.inserted).toBe(2);
    const page = await inApp.listNotifications(moderator);
    expect(page.data[0]).toMatchObject({
      type: "join_request",
      subjectType: "membership_request",
      subjectId: requestId,
      postId: null,
      href: `/c/${community.slug}/manage/inbox?tab=requests`,
      text: "Ivy asked to join",
    });
    expect((await inApp.listNotifications(regular)).data).toEqual([]);

    const { log, jobs } = mailer();
    await jobs.sendImmediate();
    const ownerAddress = await emailOf(owner);
    const ours = new Set([
      ownerAddress,
      await emailOf(moderator),
      await emailOf(regular),
      await emailOf(requester),
    ]);
    expect(
      log.sent
        .map((m) => m.to)
        .filter((to) => ours.has(to))
        .sort(),
    ).toEqual([ownerAddress]);
    expect(log.sent.find((m) => m.to === ownerAddress)?.text).toContain(
      `http://cohory.test/c/${community.slug}/manage/inbox?tab=requests`,
    );
  });

  it("tells the requester about an approval in the app and about a decline by email", async () => {
    const community = await newCommunity("glaze");
    const admin = await member(community.id, "Ari", "admin");
    const approved = await member(community.id, "Bea", "member");
    const declined = await newUser("Cal");

    await notify([
      {
        type: "join_request.decided",
        payload: {
          communityId: community.id,
          requestId: newId(),
          userId: approved.userId,
          decidedBy: admin.userId,
          status: "approved",
        },
      },
      {
        type: "join_request.decided",
        payload: {
          communityId: community.id,
          requestId: newId(),
          userId: declined.userId,
          decidedBy: admin.userId,
          status: "declined",
        },
      },
    ]);

    expect((await inApp.listNotifications(approved)).data[0]).toMatchObject({
      type: "join_request_approved",
      href: `/c/${community.slug}`,
      text: "Your request to join was approved",
    });
    const { log, jobs } = mailer();
    clock += 1000;
    await jobs.sendImmediate();
    const declinedAddress = await emailOf(declined);
    expect(log.sent.map((m) => m.to)).toContain(await emailOf(approved));
    const declineMail = log.sent.find((m) => m.to === declinedAddress);
    expect(declineMail?.subject).toBe("[Potters] Your request to join was declined");
    expect(declineMail?.text).toContain(`http://cohory.test/c/${community.slug}/about`);
  });

  it("notifies the previous and the new owner once each about a transfer", async () => {
    const community = await newCommunity("kiln");
    const previous = await member(community.id, "Pia", "admin");
    const next = await member(community.id, "Noor", "owner");
    const bystander = await member(community.id, "Ugo", "member");
    const event = {
      type: "ownership.transferred" as const,
      payload: {
        communityId: community.id,
        noticeId: newId(),
        previousOwnerId: previous.userId,
        newOwnerId: next.userId,
      },
    };

    const first = await notify([event]);
    const again = await notify([event]);

    expect(first.inserted).toBe(2);
    expect(again.inserted).toBe(0);
    const text =
      "Potters has a new owner. If it sells memberships, new checkouts pause until the new owner chooses a Stripe account in Manage, Payments.";
    for (const person of [previous, next]) {
      const page = await inApp.listNotifications(person);
      expect(page.data).toHaveLength(1);
      expect(page.data[0]).toMatchObject({
        type: "ownership_transferred",
        subjectType: "community",
        subjectId: community.id,
        href: `/c/${community.slug}/manage/payments`,
        text,
      });
    }
    expect((await inApp.listNotifications(bystander)).data).toEqual([]);
    const toNewOwner = sent.filter(
      (message) => message.subject === "[Potters] You are now the owner",
    );
    expect(toNewOwner.map((message) => message.to)).toEqual([await emailOf(next)]);
    expect(toNewOwner[0]?.text).toContain(`http://cohory.test/c/${community.slug}/manage/payments`);
    expect(toNewOwner[0]?.text).toContain("Pia made you the owner of Potters.");
  });

  it("retries the new owner email after a failed send without a second email", async () => {
    const community = await newCommunity("potters");
    const previous = await member(community.id, "Olga", "admin");
    const next = await member(community.id, "Noor", "owner");
    const event = {
      type: "ownership.transferred" as const,
      payload: {
        communityId: community.id,
        noticeId: newId(),
        previousOwnerId: previous.userId,
        newOwnerId: next.userId,
      },
    };
    const address = await emailOf(next);

    failNextSend = true;
    await expect(notify([event])).rejects.toThrow("smtp down");
    await notify([event]);
    await notify([event]);

    expect(sent.filter((message) => message.to === address)).toHaveLength(1);
    expect((await inApp.listNotifications(next)).data).toHaveLength(1);
  });
});
