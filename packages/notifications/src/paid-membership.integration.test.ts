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
import { communities, notifications, users } from "@cohory/db/schema";
import { createLogMailer, type EmailMessage } from "@cohory/email";
import type { PaidMembershipEventsJobPayload } from "@cohory/events";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createNotificationEmailJobs } from "./email/delivery";
import { createPaidMembershipNotifier } from "./paid-membership";
import { createNotificationsService } from "./service";

type PaidEvent = PaidMembershipEventsJobPayload["events"][number];

const probeRole = "cohory_paid_membership_notify_probe";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const adminPool = createPool(adminUrl);
const adminDb = createDb(adminPool);
const appUrl = new URL(adminUrl);
appUrl.searchParams.set("options", `-c role=${probeRole}`);
const appPool = createPool(appUrl.toString());
const appDb = createDb(appPool);

let clock = new Date("2026-10-20T07:00:00Z").getTime();
const now = () => new Date(clock);
const inApp = createNotificationsService({ db: appDb, now });

type UserActor = Actor & { kind: "user" };

async function newUser(name: string): Promise<UserActor> {
  const [row] = await adminDb
    .insert(users)
    .values({ name, email: `paid-${newId()}@example.test`, emailVerified: true })
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

async function newCommunity() {
  return createCommunity(adminDb, {
    slug: communitySlugSchema.parse(`makers-${newId().slice(-8)}`),
    name: "Makers",
  });
}

function setup(options: { failFor?: string } = {}) {
  const log = createLogMailer({ log: () => undefined });
  let failures = options.failFor ? 1 : 0;
  const notify = createPaidMembershipNotifier({
    db: appDb,
    appUrl: "http://cohory.test",
    now,
    send: async (message: EmailMessage) => {
      if (failures > 0 && message.to === options.failFor) {
        failures -= 1;
        throw new Error("smtp down");
      }
      await log.send(message);
    },
  });
  return { log, notify };
}

function changed(
  community: { id: string; slug: string; name: string },
  actorId: string,
  recipients: readonly UserActor[],
  overrides: Partial<Extract<PaidEvent, { type: "paid_membership.changed" }>["payload"]> = {},
): PaidEvent {
  return {
    type: "paid_membership.changed",
    payload: {
      noticeId: newId(),
      communityId: community.id,
      communitySlug: community.slug,
      communityName: community.name,
      actorId,
      change: "archived_ending",
      supportContact: null,
      portalLoginUrl: null,
      recipients: recipients.map((recipient) => ({
        userId: recipient.userId,
        endsAt: "2026-11-18T10:00:00.000Z",
      })),
      ...overrides,
    },
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
    grant select, insert, update, delete on memberships, outbox, notifications, notification_preferences, notification_settings, notification_deliveries to ${probeRole};
  `),
  );
});

afterAll(async () => {
  await appPool.end();
  await adminPool.end();
});

describe("paid membership notices", () => {
  it("gives each recipient one in-app notice and one email", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "Olga", "owner");
    const ada = await member(community.id, "Ada", "member");
    const ben = await member(community.id, "Ben", "member");
    const { log, notify } = setup();

    const result = await notify([changed(community, owner.userId, [ada, ben])]);

    expect(result).toEqual({ inserted: 2, emailed: 2 });
    const [notice] = (await inApp.listNotifications(ada)).data;
    expect(notice).toMatchObject({
      type: "paid_membership_changed",
      subjectType: "community",
      subjectId: community.id,
      text: "Makers is archived. Your subscription ends on November 18, 2026 and will not renew. You can read the community until then.",
    });
    const sent = log.sent.map((message) => message.to).sort();
    expect(sent).toEqual([await emailOf(ada), await emailOf(ben)].sort());
    expect(log.sent[0]?.text).toContain(`http://cohory.test/c/${community.slug}/membership`);
  });

  it("sends nothing new when the same job runs again", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "Olga", "owner");
    const ada = await member(community.id, "Ada", "member");
    const { log, notify } = setup();
    const event = changed(community, owner.userId, [ada]);

    await notify([event]);
    const again = await notify([event]);

    expect(again).toEqual({ inserted: 0, emailed: 0 });
    expect(log.sent).toHaveLength(1);
    expect((await inApp.listNotifications(ada)).data).toHaveLength(1);
  });

  it("gives one notice and one email per recipient when retried after a partial send", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "Olga", "owner");
    const ada = await member(community.id, "Ada", "member");
    const ben = await member(community.id, "Ben", "member");
    const { log, notify } = setup({ failFor: await emailOf(ben) });
    const event = changed(community, owner.userId, [ada, ben]);

    await expect(notify([event])).rejects.toThrow("smtp down");
    expect((await inApp.listNotifications(ben)).data).toHaveLength(0);
    const retried = await notify([event]);

    expect(retried).toEqual({ inserted: 1, emailed: 1 });
    expect(log.sent.map((message) => message.to).sort()).toEqual(
      [await emailOf(ada), await emailOf(ben)].sort(),
    );
    expect((await inApp.listNotifications(ada)).data).toHaveLength(1);
    expect((await inApp.listNotifications(ben)).data).toHaveLength(1);
  });

  it("shows only the latest notice when the owner changes the choice", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "Olga", "owner");
    const ada = await member(community.id, "Ada", "member");
    const { log, notify } = setup();

    await notify([changed(community, owner.userId, [ada], { change: "archived_continuing" })]);
    clock += 60_000;
    await notify([changed(community, owner.userId, [ada], { change: "archived_ending" })]);

    expect(log.sent).toHaveLength(2);
    expect(await inApp.unreadCount(ada)).toBe(1);
    const [latest] = (await inApp.listNotifications(ada)).data;
    expect(latest?.text).toContain("ends on November 18, 2026");
  });

  it("emails members of a deleted community without an in-app notice", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "Olga", "owner");
    const ada = await member(community.id, "Ada", "member");
    const event = changed(community, owner.userId, [ada], { change: "community_deleted" });
    await adminDb.delete(communities).where(eq(communities.id, community.id));
    const { log, notify } = setup();

    const result = await notify([event]);

    expect(result).toEqual({ inserted: 0, emailed: 1 });
    expect(log.sent[0]).toMatchObject({
      to: await emailOf(ada),
      subject: "[Makers] Your membership has ended",
    });
    expect(log.sent[0]?.text).not.toContain("http://cohory.test/c/");
    const rows = await adminDb
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.userId, ada.userId));
    expect(rows).toEqual([]);
  });

  it("never puts another member's name or email in a message", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "Olga", "owner");
    const ada = await member(community.id, "Ada Lovelace", "member");
    const ben = await member(community.id, "Ben Franklin", "member");
    const { log, notify } = setup();

    await notify([
      changed(community, owner.userId, [ada, ben], {
        change: "billed_by_creator",
        supportContact: "support@makers.test",
      }),
    ]);

    const adaEmail = await emailOf(ada);
    const benEmail = await emailOf(ben);
    for (const message of log.sent) {
      const other = message.to === adaEmail ? benEmail : adaEmail;
      const otherName = message.to === adaEmail ? "Ben Franklin" : "Ada Lovelace";
      const body = `${message.subject}\n${message.text}\n${message.html}`;
      expect(body).not.toContain(other);
      expect(body).not.toContain(otherName);
      expect(body).not.toMatch(/\b2 (paying )?members?\b/);
    }
  });

  it("skips erased people", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "Olga", "owner");
    const ada = await member(community.id, "Ada", "member");
    await adminDb.update(users).set({ erasedAt: now() }).where(eq(users.id, ada.userId));
    const { log, notify } = setup();

    expect(await notify([changed(community, owner.userId, [ada])])).toEqual({
      inserted: 0,
      emailed: 0,
    });
    expect(log.sent).toEqual([]);
  });

  it("emails the owner how to clear the fee", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "Olga", "owner");
    const { log, notify } = setup();
    const event: PaidEvent = {
      type: "payments.fee_clear_required",
      payload: {
        noticeId: newId(),
        communityId: community.id,
        communitySlug: community.slug,
        communityName: community.name,
        ownerId: owner.userId,
      },
    };

    expect(await notify([event])).toEqual({ inserted: 0, emailed: 1 });

    expect(log.sent).toHaveLength(1);
    expect(log.sent[0]).toMatchObject({
      to: await emailOf(owner),
      subject: "[Makers] Remove the Cohory fee in your Stripe Dashboard",
    });
  });

  it("emails the member when cohory refunds and cancels their second paid subscription", async () => {
    const community = await newCommunity();
    const buyer = await member(community.id, "Bea", "member");
    const { log, notify } = setup();
    const event: PaidEvent = {
      type: "payments.duplicate_refunded",
      payload: {
        noticeId: newId(),
        communityId: community.id,
        communitySlug: community.slug,
        communityName: community.name,
        userId: buyer.userId,
        amountMinor: 4900,
        currency: "usd",
      },
    };

    expect(await notify([event])).toEqual({ inserted: 0, emailed: 1 });

    expect(log.sent[0]).toMatchObject({
      to: await emailOf(buyer),
      subject: "[Makers] We refunded your second payment of $49.00",
    });
    expect(log.sent[0]?.text).toContain(`/c/${community.slug}/membership`);
  });

  it("tells the owner about a disputed payment once, in app and by email", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "Olga", "owner");
    const { log, notify } = setup();
    const event: PaidEvent = {
      type: "payments.payment_disputed",
      payload: {
        noticeId: newId(),
        communityId: community.id,
        communitySlug: community.slug,
        communityName: community.name,
        ownerId: owner.userId,
        amountMinor: 4900,
        currency: "usd",
      },
    };

    expect(await notify([event])).toEqual({ inserted: 1, emailed: 1 });
    expect(await notify([event])).toEqual({ inserted: 0, emailed: 0 });

    expect(log.sent).toHaveLength(1);
    expect(log.sent[0]).toMatchObject({
      to: await emailOf(owner),
      subject: "[Makers] A member disputed a payment of $49.00",
    });
    const page = await inApp.listNotifications(owner);
    expect(page.data.map((notice) => [notice.type, notice.href, notice.text])).toEqual([
      [
        "payment_disputed",
        `/c/${community.slug}/manage/payments`,
        "A member disputed a payment of $49.00 in Makers. Answer it in your Stripe Dashboard before the deadline Stripe shows. The member keeps access while the dispute is open.",
      ],
    ]);
  });

  it("is not emailed again by the notification email job", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "Olga", "owner");
    const ada = await member(community.id, "Ada", "member");
    const { notify } = setup();
    await notify([changed(community, owner.userId, [ada])]);

    const log = createLogMailer({ log: () => undefined });
    const jobs = createNotificationEmailJobs({
      db: appDb,
      send: (message) => log.send(message),
      appUrl: "http://cohory.test",
      secret: "integration-secret-that-is-at-least-32-chars",
      now,
    });
    await jobs.sendImmediate();

    const address = await emailOf(ada);
    expect(log.sent.filter((message) => message.to === address)).toEqual([]);
  });

  describe("money events for the owner", () => {
    function base(
      community: { id: string; slug: string; name: string },
      ownerId: string,
      userId: string,
    ) {
      return {
        noticeId: newId(),
        communityId: community.id,
        communitySlug: community.slug,
        communityName: community.name,
        ownerId,
        userId,
      };
    }

    it("tells the owner about a new paying member and a cancellation in the app only", async () => {
      const community = await newCommunity();
      const owner = await member(community.id, "Olga", "owner");
      const sam = await member(community.id, "Sam", "member");
      const { log, notify } = setup();
      const joined: PaidEvent = {
        type: "payments.paid_member_joined",
        payload: {
          ...base(community, owner.userId, sam.userId),
          priceMinor: 4900,
          currency: "USD",
          interval: "month",
        },
      };
      const canceled: PaidEvent = {
        type: "payments.paid_member_canceled",
        payload: {
          ...base(community, owner.userId, sam.userId),
          endsAt: "2026-11-30T10:00:00.000Z",
        },
      };

      expect(await notify([joined])).toEqual({ inserted: 1, emailed: 0 });
      clock += 1000;
      expect(await notify([canceled])).toEqual({ inserted: 1, emailed: 0 });
      expect(await notify([joined, canceled])).toEqual({ inserted: 0, emailed: 0 });

      expect(log.sent).toEqual([]);
      const page = await inApp.listNotifications(owner);
      expect(page.data.map((notice) => [notice.type, notice.text, notice.href])).toEqual([
        [
          "paid_member_canceled",
          "Sam canceled their paid membership. Access ends on November 30, 2026.",
          `/c/${community.slug}/manage/people`,
        ],
        [
          "paid_member_joined",
          "Sam joined and pays $49.00/month",
          `/c/${community.slug}/manage/people`,
        ],
      ]);
    });

    it("emails the member about the first three failed tries and the last one, and tells the owner once", async () => {
      const community = await newCommunity();
      const owner = await member(community.id, "Olga", "owner");
      const sam = await member(community.id, "Sam", "member");
      const { log, notify } = setup();
      const failed = (attempt: number, nextAttemptAt: string | null): PaidEvent => ({
        type: "payments.member_payment_failed",
        payload: {
          ...base(community, owner.userId, sam.userId),
          amountMinor: 4900,
          currency: "usd",
          attempt,
          nextAttemptAt,
        },
      });
      const first = failed(1, "2026-10-23T10:00:00.000Z");

      expect(await notify([first])).toEqual({ inserted: 2, emailed: 1 });
      expect(await notify([first])).toEqual({ inserted: 0, emailed: 0 });
      clock += 1000;
      await notify([failed(2, "2026-10-26T10:00:00.000Z")]);
      clock += 1000;
      await notify([failed(3, "2026-10-29T10:00:00.000Z")]);
      clock += 1000;
      await notify([failed(4, "2026-11-01T10:00:00.000Z")]);
      clock += 1000;
      await notify([failed(6, null)]);

      const address = await emailOf(sam);
      expect(log.sent.map((message) => [message.to, message.subject])).toEqual([
        [address, "[Makers] Your payment failed"],
        [address, "[Makers] Your payment failed"],
        [address, "[Makers] Your payment failed"],
        [address, "[Makers] Your payment failed"],
      ]);
      expect(log.sent[3]?.text).toContain(
        "That was the last try, so your access ends unless you update your card.",
      );
      expect(log.sent[0]?.text).toContain("We will try again on October 23, 2026.");
      expect(log.sent[0]?.text).toContain(`/c/${community.slug}/membership`);
      const ownerPage = await inApp.listNotifications(owner);
      expect(ownerPage.data.map((notice) => [notice.type, notice.text])).toEqual([
        [
          "member_payment_failed",
          "A payment of $49.00 from Sam failed. Stripe will try again on October 23, 2026.",
        ],
      ]);
      const memberPage = await inApp.listNotifications(sam);
      expect(
        memberPage.data.map((notice) => [notice.type, notice.href, notice.readAt === null]),
      ).toEqual([
        ["paid_membership_changed", `/c/${community.slug}/membership`, true],
        ["paid_membership_changed", `/c/${community.slug}/membership`, false],
        ["paid_membership_changed", `/c/${community.slug}/membership`, false],
        ["paid_membership_changed", `/c/${community.slug}/membership`, false],
      ]);
    });

    it("retries the member email after a failed send without a second owner notice", async () => {
      const community = await newCommunity();
      const owner = await member(community.id, "Olga", "owner");
      const sam = await member(community.id, "Sam", "member");
      const { log, notify } = setup({ failFor: await emailOf(sam) });
      const event: PaidEvent = {
        type: "payments.member_payment_failed",
        payload: {
          ...base(community, owner.userId, sam.userId),
          amountMinor: 4900,
          currency: "usd",
          attempt: 1,
          nextAttemptAt: null,
        },
      };

      await expect(notify([event])).rejects.toThrow("smtp down");
      expect(await notify([event])).toEqual({ inserted: 1, emailed: 1 });

      expect(log.sent).toHaveLength(1);
      expect((await inApp.listNotifications(owner)).data).toHaveLength(1);
    });
  });
});
