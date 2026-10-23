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
  notificationDeliveries,
  notifications,
  paymentConnections,
  paymentCustomers,
  subscriptions,
  users,
} from "@cohory/db/schema";
import type { DomainEvent } from "@cohory/events";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createJoinNotifier } from "./joins";
import { createNotificationsService } from "./service";

const probeRole = "cohory_join_notify_probe";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const adminPool = createPool(adminUrl);
const adminDb = createDb(adminPool);
const appUrl = new URL(adminUrl);
appUrl.searchParams.set("options", `-c role=${probeRole}`);
const appPool = createPool(appUrl.toString());
const appDb = createDb(appPool);

let clock = new Date("2026-10-22T07:00:00Z").getTime();
const now = () => new Date((clock += 1000));
const notify = createJoinNotifier({ db: appDb, now });
const inApp = createNotificationsService({ db: appDb, now });

type UserActor = Actor & { kind: "user" };

async function newUser(name: string): Promise<UserActor> {
  const [row] = await adminDb
    .insert(users)
    .values({ name, email: `joins-${newId()}@example.test`, emailVerified: true })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert returned no row");
  return { kind: "user", userId: row.id, platformAdmin: false };
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
    slug: communitySlugSchema.parse(`joins-${newId().slice(-8)}`),
    name: "Potters",
  });
}

async function subscribe(communityId: CommunityId, userId: string) {
  await runInCommunity(withCommunity(adminDb, communityId), async ({ tx, values }) => {
    await setRlsFlag(tx, "payments_manager");
    const [connection] = await tx
      .insert(paymentConnections)
      .values(values({ provider: "stripe_connect" as const, status: "active" as const }))
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
        currentPeriodEnd: new Date("2026-12-01T00:00:00Z"),
        cancelAtPeriodEnd: false,
        applicationFeeBps: 200,
        providerFetchedAt: new Date(),
      }),
    );
  });
}

function joined(communityId: string, userId: string, role: CommunityRole = "member"): DomainEvent {
  return {
    type: "member.joined",
    payload: { communityId, userId, role, occurredAt: new Date(clock).toISOString() },
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
    grant select, insert, update, delete on memberships, notifications, notification_preferences, notification_deliveries, notification_group_sources to ${probeRole};
    grant select on subscriptions to ${probeRole};
  `),
  );
});

afterAll(async () => {
  await appPool.end();
  await adminPool.end();
});

describe("new member notifications", () => {
  it("tells the owner and admins in one grouped line, not moderators or members", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "Olga", "owner");
    const admin = await member(community.id, "Ann", "admin");
    const moderator = await member(community.id, "Max", "moderator");
    const regular = await member(community.id, "Rae", "member");
    const jamie = await member(community.id, "Jamie", "member");
    const taylor = await member(community.id, "Taylor", "member");

    const first = joined(community.id, jamie.userId);
    await notify([first]);
    await notify([first]);
    await notify([joined(community.id, taylor.userId)]);

    for (const host of [owner, admin]) {
      const page = await inApp.listNotifications(host);
      expect(page.data.map((n) => [n.type, n.text, n.href])).toEqual([
        [
          "member_joined",
          "Taylor and 1 other joined the community",
          `/c/${community.slug}/manage/people`,
        ],
      ]);
    }
    expect((await inApp.listNotifications(moderator)).data).toEqual([]);
    expect((await inApp.listNotifications(regular)).data).toEqual([]);
  });

  it("counts a retried join once after another member joined in between", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "Olga", "owner");
    const jamie = await member(community.id, "Jamie", "member");
    const taylor = await member(community.id, "Taylor", "member");

    const first = joined(community.id, jamie.userId);
    await notify([first]);
    await notify([joined(community.id, taylor.userId)]);
    await notify([first]);

    const page = await inApp.listNotifications(owner);
    expect(page.data.map((n) => n.text)).toEqual(["Taylor and 1 other joined the community"]);
  });

  it("leaves a paid join to the paying member notice", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "Olga", "owner");
    const payer = await member(community.id, "Pat", "member");
    await subscribe(community.id, payer.userId);

    expect(await notify([joined(community.id, payer.userId)])).toEqual({ inserted: 0 });
    expect((await inApp.listNotifications(owner)).data).toEqual([]);
  });

  it("ignores the owner joining the community they created", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "Olga", "owner");

    expect(await notify([joined(community.id, owner.userId, "owner")])).toEqual({ inserted: 0 });
  });

  it("starts a new group once the earlier one went out by email", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "Olga", "owner");
    const jamie = await member(community.id, "Jamie", "member");
    const sam = await member(community.id, "Sam", "member");

    await notify([joined(community.id, jamie.userId)]);
    const [emailed] = await adminDb
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.userId, owner.userId));
    if (!emailed) throw new Error("expected a notification");
    await adminDb.insert(notificationDeliveries).values({
      notificationId: emailed.id,
      userId: owner.userId,
      channel: "email",
      outcome: "sent",
    });
    await notify([joined(community.id, sam.userId)]);

    const page = await inApp.listNotifications(owner);
    expect(page.data.map((n) => n.text)).toEqual([
      "Sam joined the community",
      "Jamie joined the community",
    ]);
  });
});
