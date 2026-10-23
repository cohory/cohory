import type { CommunityRole } from "@cohory/authz";
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
import { memberships, notificationSettings, users } from "@cohory/db/schema";
import type { EmailMessage } from "@cohory/email";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWelcomeEmailJob, type WelcomeExtras } from "./job";

const probeRole = "cohory_welcome_email_probe";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const adminPool = createPool(adminUrl);
const adminDb = createDb(adminPool);
const appUrl = new URL(adminUrl);
appUrl.searchParams.set("options", `-c role=${probeRole}`);
const appPool = createPool(appUrl.toString());
const appDb = createDb(appPool);
const at = new Date("2026-10-22T10:02:00Z");

const extras: WelcomeExtras = {
  firstCourse: { slug: "start-here", title: "Start here" },
  nextEvent: {
    eventSlug: "office-hours",
    occurrenceId: "o1",
    title: "Office hours",
    startsAt: new Date("2026-10-23T16:00:00Z"),
  },
};

function job() {
  const sent: EmailMessage[] = [];
  const sendWelcome = createWelcomeEmailJob({
    db: appDb,
    source: async () => extras,
    send: async (message) => void sent.push(message),
    appUrl: "https://cohory.test/",
    now: () => at,
  });
  return { sent, sendWelcome };
}

async function newUser(name: string, emailVerified = true): Promise<string> {
  const [row] = await adminDb
    .insert(users)
    .values({ name, email: `welcome-${newId()}@example.test`, emailVerified })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

async function join(communityId: CommunityId, userId: string, role: CommunityRole = "member") {
  await addMembership(withCommunity(adminDb, communityId), {
    userId,
    role,
    status: "active",
    joinedAt: new Date(at.getTime() - 120_000),
  });
}

async function community(name: string) {
  const created = await createCommunity(adminDb, {
    slug: communitySlugSchema.parse(`welcome-${newId().slice(-8)}`),
    name,
  });
  const ownerId = await newUser("Riza");
  await join(created.id, ownerId, "owner");
  return { ...created, ownerId };
}

async function sentAt(communityId: string, userId: string): Promise<Date | null> {
  const [row] = await adminDb
    .select({ at: memberships.welcomeEmailSentAt })
    .from(memberships)
    .where(and(eq(memberships.communityId, communityId), eq(memberships.userId, userId)));
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
    grant select on communities, users, notification_settings to ${probeRole};
    grant select, update on memberships to ${probeRole};
    grant select on subscriptions, payment_connections, payment_customers, comped_memberships, membership_plans to ${probeRole};
  `),
  );
});

afterAll(async () => {
  await appPool.end();
  await adminPool.end();
});

describe("welcome email job", () => {
  it("sends one welcome with the creator, first course, and next event in the member's time zone", async () => {
    const makers = await community("Makers");
    const ada = await newUser("Ada");
    await adminDb.insert(notificationSettings).values({ userId: ada, timeZone: "Europe/Istanbul" });
    await join(makers.id, ada);
    const { sent, sendWelcome } = job();

    expect(await sendWelcome({ communityId: makers.id, userId: ada })).toBe("sent");
    expect(await sendWelcome({ communityId: makers.id, userId: ada })).toBe("skipped");

    expect(sent).toHaveLength(1);
    const [email] = sent;
    expect(email?.subject).toBe("[Makers] Welcome to Makers");
    expect(email?.text).toContain("Hi Ada,");
    expect(email?.text).toContain("meet Riza");
    expect(email?.text).toContain(`https://cohory.test/c/${makers.slug}/classroom/start-here`);
    expect(email?.text).toContain("Friday, October 23");
    expect(email?.text).toContain("7:00 PM GMT+3");
    expect(email?.text).toContain(`https://cohory.test/c/${makers.slug}?compose=1`);
    expect(await sentAt(makers.id, ada)).toEqual(at);
  });

  it("marks only the membership in the community that sent the welcome", async () => {
    const makers = await community("Makers");
    const gardeners = await community("Gardeners");
    const ada = await newUser("Ada");
    await join(makers.id, ada);
    await join(gardeners.id, ada);
    const { sendWelcome } = job();

    await sendWelcome({ communityId: makers.id, userId: ada });

    expect(await sentAt(makers.id, ada)).toEqual(at);
    expect(await sentAt(gardeners.id, ada)).toBeNull();
  });

  it("skips the owner, unconfirmed addresses, and members who left before it ran", async () => {
    const makers = await community("Makers");
    const unverified = await newUser("Unverified", false);
    const leaver = await newUser("Leaver");
    await join(makers.id, unverified);
    await join(makers.id, leaver);
    await adminDb
      .update(memberships)
      .set({ status: "removed" })
      .where(and(eq(memberships.communityId, makers.id), eq(memberships.userId, leaver)));
    const { sent, sendWelcome } = job();

    expect(await sendWelcome({ communityId: makers.id, userId: makers.ownerId })).toBe("skipped");
    expect(await sendWelcome({ communityId: makers.id, userId: unverified })).toBe("skipped");
    expect(await sendWelcome({ communityId: makers.id, userId: leaver })).toBe("skipped");
    expect(sent).toHaveLength(0);
  });
});
