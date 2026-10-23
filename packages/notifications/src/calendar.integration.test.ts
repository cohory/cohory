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
  notificationDeliveries,
  notificationPreferences,
  notifications,
  notificationSettings,
  paymentConnections,
  paymentCustomers,
  subscriptions,
  users,
} from "@cohory/db/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCalendarNotifier } from "./calendar";
import { verifyUnsubscribeToken } from "./unsubscribe";

const probeRole = "cohory_calendar_notify_probe";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const adminPool = createPool(adminUrl);
const adminDb = createDb(adminPool);
const appUrl = new URL(adminUrl);
appUrl.searchParams.set("options", `-c role=${probeRole}`);
const appPool = createPool(appUrl.toString());
const appDb = createDb(appPool);
const secret = "calendar-notifier-test-secret-32-characters";

const notifier = createCalendarNotifier({ db: appDb, appUrl: "http://cohory.test", secret });

async function member(communityId: CommunityId, role: CommunityRole) {
  const [row] = await adminDb
    .insert(users)
    .values({ name: role, email: `calendar-${newId()}@example.test`, emailVerified: true })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert returned no row");
  await addMembership(withCommunity(adminDb, communityId), {
    userId: row.id,
    role,
    status: "active",
    joinedAt: new Date(),
  });
  return row.id;
}

async function newCommunity() {
  return createCommunity(adminDb, {
    slug: communitySlugSchema.parse(`calendar-${newId().slice(-8)}`),
    name: "Potters",
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
    grant select on communities, users, subscriptions, payment_connections, comped_memberships,
      membership_plans to ${probeRole};
    grant select, insert, update, delete on memberships, notifications, notification_preferences, notification_settings, notification_deliveries to ${probeRole};
  `),
  );
});

afterAll(async () => {
  await appPool.end();
  await adminPool.end();
});

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

describe("calendar notifier", () => {
  it("tells every active member but the creator about a new event, once", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "owner");
    const first = await member(community.id, "member");
    const second = await member(community.id, "admin");
    const eventId = newId();
    const notice = {
      communityId: community.id,
      eventId,
      actorId: owner,
      detail: "New event: Call",
    };

    const inserted = await notifier.eventCreated(notice);
    await notifier.eventCreated(notice);
    const rows = await adminDb
      .select()
      .from(notifications)
      .where(eq(notifications.subjectId, eventId));

    expect(inserted).toBe(2);
    expect(rows.map((row) => row.userId).sort()).toEqual([first, second].sort());
    expect(rows[0]).toMatchObject({
      type: "event_created",
      subjectType: "event",
      actorId: owner,
      detail: "New event: Call",
    });
  });

  it("records an in-app reminder that the email job never sends again", async () => {
    const community = await newCommunity();
    const userId = await member(community.id, "member");
    const occurrenceId = newId();

    const mail = await notifier.eventReminder({
      communityId: community.id,
      occurrenceId,
      userId,
      detail: "Starts in 1 hour: Call",
    });
    const [row] = await adminDb
      .select()
      .from(notifications)
      .where(eq(notifications.subjectId, occurrenceId));
    const deliveries = await adminDb
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.userId, userId));

    expect(row).toMatchObject({ type: "event_reminder", userId, detail: "Starts in 1 hour: Call" });
    expect(deliveries).toMatchObject([
      { notificationId: row?.id, channel: "email", outcome: "sent" },
    ]);
    expect(mail.email).toBe(true);
    expect(mail.timeZone).toBeNull();
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const token = new URL(mail.unsubscribeUrl ?? "").searchParams.get("token") ?? "";
    expect(verifyUnsubscribeToken(secret, token)).toEqual({ userId, scope: "event_reminder" });
  });

  it("follows the member's reminder email setting and time zone", async () => {
    const community = await newCommunity();
    const userId = await member(community.id, "member");
    await adminDb.insert(notificationSettings).values({ userId, timeZone: "America/New_York" });
    await adminDb
      .insert(notificationPreferences)
      .values({ userId, type: "event_reminder", inApp: true, email: "off" });

    const reminder = await notifier.eventReminder({
      communityId: community.id,
      occurrenceId: newId(),
      userId,
      detail: "Starts in 1 hour: Call",
    });
    const confirmation = await notifier.eventMail(userId);
    const [delivery] = await adminDb
      .select({ outcome: notificationDeliveries.outcome })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.userId, userId));

    expect(reminder).toMatchObject({ email: false, timeZone: "America/New_York" });
    expect(confirmation).toMatchObject({ email: false, timeZone: "America/New_York" });
    expect(delivery?.outcome).toBe("skipped");
  });

  it("leaves out members who turned off in-app new event notices or whose paid access ended", async () => {
    const community = await newCommunity();
    const owner = await member(community.id, "owner");
    const admin = await member(community.id, "admin");
    const quiet = await member(community.id, "admin");
    const unpaid = await member(community.id, "member");
    await adminDb
      .insert(notificationPreferences)
      .values({ userId: quiet, type: "event_created", inApp: false, email: "off" });
    await endPaidAccess(community.id, unpaid);
    const eventId = newId();

    const inserted = await notifier.eventCreated({
      communityId: community.id,
      eventId,
      actorId: owner,
      detail: "New event: Call",
    });
    const rows = await adminDb
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(eq(notifications.subjectId, eventId));

    expect(inserted).toBe(1);
    expect(rows.map((row) => row.userId)).toEqual([admin]);
    expect(rows.map((row) => row.userId)).not.toContain(unpaid);
  });

  it("records no in-app reminder when in-app event reminders are off, and still emails", async () => {
    const community = await newCommunity();
    const userId = await member(community.id, "member");
    await adminDb
      .insert(notificationPreferences)
      .values({ userId, type: "event_reminder", inApp: false, email: "immediate" });
    const occurrenceId = newId();

    const mail = await notifier.eventReminder({
      communityId: community.id,
      occurrenceId,
      userId,
      detail: "Starts in 1 hour: Call",
    });
    const rows = await adminDb
      .select()
      .from(notifications)
      .where(eq(notifications.subjectId, occurrenceId));

    expect(rows).toEqual([]);
    expect(mail.email).toBe(true);
  });
});
