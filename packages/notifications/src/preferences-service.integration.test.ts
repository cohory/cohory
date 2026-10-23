import type { Actor } from "@cohory/authz";
import {
  addMembership,
  communitySlugSchema,
  createCommunity,
  createDb,
  createPool,
  newId,
  parseAdminDatabaseEnv,
  setRlsValue,
  withCommunity,
  type CommunityId,
} from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import { notificationPreferences, notifications, users } from "@cohory/db/schema";
import { createPostgresPostsRepository, createPostsService } from "@cohory/posts";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createNotificationsFanout } from "./fanout";
import { createPreferencesService } from "./preferences-service";
import { createNotificationsService } from "./service";
import { createUnsubscribeToken } from "./unsubscribe";

const probeRole = "cohory_notification_prefs_probe";
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

async function newUser(name: string): Promise<UserActor> {
  const [row] = await adminDb
    .insert(users)
    .values({ name, email: `email-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!row) {
    throw new Error("user insert returned no row");
  }
  return { kind: "user", userId: row.id, platformAdmin: false };
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

let community: CommunityId;
let author: UserActor;

async function member(
  name: string,
  role: "owner" | "admin" | "moderator" | "member" = "member",
): Promise<UserActor> {
  const actor = await newUser(name);
  await addMembership(withCommunity(adminDb, community), {
    userId: actor.userId,
    role,
    status: "active",
    joinedAt: new Date(),
  });
  return actor;
}

async function mention(target: UserActor): Promise<void> {
  const { events } = await posts.createPost(author, community, { body: mentioning(target) });
  await fanOut(events);
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

describe("unsubscribe", () => {
  it("turns off email for the type in the token without a session", async () => {
    const hal = await member("Hal");
    const token = createUnsubscribeToken(secret, { userId: hal.userId, scope: "mention" });

    expect(await preferences.unsubscribe(token)).toEqual({ scope: "mention", label: "mentions" });

    const after = await preferences.getPreferences(hal);
    expect(after.types.find((item) => item.type === "mention")?.email).toBe("off");
    expect(after.types.find((item) => item.type === "reply")?.email).toBe("immediate");
  });

  it("turns off every daily type with a daily summary token", async () => {
    const ivy = await member("Ivy");
    const token = createUnsubscribeToken(secret, { userId: ivy.userId, scope: "daily" });

    await preferences.unsubscribe(token);

    const after = await preferences.getPreferences(ivy);
    expect(after.types.map((item) => item.email)).toEqual([
      "immediate",
      "immediate",
      "off",
      "off",
      "immediate",
      "immediate",
      "immediate",
      "immediate",
      "off",
      "off",
      "immediate",
      "off",
      "off",
      "off",
      "off",
      "off",
      "off",
      "off",
      "immediate",
      "off",
    ]);
  });

  it("turns off only the weekly digest with a weekly token and keeps the digest hour", async () => {
    const lee = await member("Lee");
    await preferences.updatePreferences(lee, { digestHour: 18 });
    const token = createUnsubscribeToken(secret, { userId: lee.userId, scope: "weekly" });

    expect(await preferences.unsubscribe(token)).toEqual({
      scope: "weekly",
      label: "weekly digests",
    });

    const after = await preferences.getPreferences(lee);
    expect(after).toMatchObject({ weeklyDigest: false, digestHour: 18 });
    expect(after.types.find((item) => item.type === "comment_on_post")?.email).toBe("daily");
  });

  it("turns the weekly digest back on from the settings", async () => {
    const mo = await member("Mo");
    expect((await preferences.getPreferences(mo)).weeklyDigest).toBe(true);

    await preferences.updatePreferences(mo, { weeklyDigest: false });
    expect((await preferences.getPreferences(mo)).weeklyDigest).toBe(false);

    await preferences.updatePreferences(mo, { weeklyDigest: true });
    expect((await preferences.getPreferences(mo)).weeklyDigest).toBe(true);
  });

  it("refuses a token for an erased account and writes nothing for it", async () => {
    const jo = await member("Jo");
    const token = createUnsubscribeToken(secret, { userId: jo.userId, scope: "reply" });
    await adminDb.update(users).set({ erasedAt: new Date() }).where(eq(users.id, jo.userId));

    expect(await preferences.unsubscribe(token)).toBeNull();
    const rows = await adminDb
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, jo.userId));
    expect(rows).toEqual([]);
  });

  it("refuses a forged token", async () => {
    const jo = await member("Jo");
    const token = createUnsubscribeToken(`${secret}-wrong`, { userId: jo.userId, scope: "reply" });

    expect(await preferences.unsubscribe(token)).toBeNull();
    expect((await preferences.getPreferences(jo)).types[1]?.email).toBe("immediate");
  });
});

describe("join request defaults", () => {
  function joinRequestEmail(prefs: Awaited<ReturnType<typeof preferences.getPreferences>>) {
    return prefs.types.find((item) => item.type === "join_request")?.email;
  }

  it("shows right away to an owner and the daily summary to admins, moderators, and members", async () => {
    const owner = await member("Olga", "owner");
    const admin = await member("Ari", "admin");
    const moderator = await member("Max", "moderator");

    expect(joinRequestEmail(await preferences.getPreferences(owner))).toBe("immediate");
    expect(joinRequestEmail(await preferences.getPreferences(admin))).toBe("daily");
    expect(joinRequestEmail(await preferences.getPreferences(moderator))).toBe("daily");
  });

  it("shows the saved choice over the role default", async () => {
    const admin = await member("Abe", "admin");
    await preferences.updatePreferences(admin, {
      types: [{ type: "join_request", inApp: true, email: "immediate" }],
    });

    expect(joinRequestEmail(await preferences.getPreferences(admin))).toBe("immediate");
  });
});

describe("join request defaults when saving or unsubscribing", () => {
  async function storedJoinRequest(actor: UserActor) {
    const rows = await adminDb
      .select({ type: notificationPreferences.type, email: notificationPreferences.email })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, actor.userId));
    return rows.find((row) => row.type === "join_request")?.email ?? null;
  }

  it("does not freeze the role default when the form is saved for another reason", async () => {
    const admin = await member("Ada", "admin");
    const current = await preferences.getPreferences(admin);

    await preferences.updatePreferences(admin, {
      types: current.types.map((item) =>
        item.type === "mention" ? { ...item, email: "off" as const } : item,
      ),
    });

    expect(await storedJoinRequest(admin)).toBeNull();
  });

  it("stops join requests too when an owner of one community and admin of another stops daily summaries", async () => {
    const owner = await member("Ola", "admin");
    const other = await createCommunity(adminDb, {
      slug: communitySlugSchema.parse(`prefs-b-${newId().slice(-12)}`),
      name: "Second",
    });
    await addMembership(withCommunity(adminDb, other.id), {
      userId: owner.userId,
      role: "owner",
      status: "active",
      joinedAt: new Date(),
    });
    const token = createUnsubscribeToken(secret, { userId: owner.userId, scope: "daily" });

    const result = await preferences.unsubscribe(token);

    expect(await storedJoinRequest(owner)).toBe("off");
    expect(result?.label).toBe("daily summaries and join requests");
  });
});

describe("in-app preference", () => {
  it("hides a type from the list and the unread count when in-app is off, and shows it again when on", async () => {
    const kit = await member("Kit");
    await mention(kit);
    expect(await inApp.unreadCount(kit)).toBe(1);

    await preferences.updatePreferences(kit, {
      types: [{ type: "mention", inApp: false, email: "immediate" }],
    });
    expect(await inApp.unreadCount(kit)).toBe(0);
    expect((await inApp.listNotifications(kit)).data).toEqual([]);

    await preferences.updatePreferences(kit, {
      types: [{ type: "mention", inApp: true, email: "immediate" }],
    });
    expect(await inApp.unreadCount(kit)).toBe(1);
  });
});

describe("row level security on preference tables", () => {
  it("keeps each member's preferences private", async () => {
    const lee = await member("Lee");
    const max = await member("Max");
    await preferences.updatePreferences(lee, {
      types: [{ type: "reply", inApp: false, email: "off" }],
    });

    const seenByMax = await appDb.transaction(async (tx) => {
      await setRlsValue(tx, "user_id", max.userId);
      return tx.select().from(notificationPreferences);
    });
    const seenByNobody = await appDb.select().from(notifications);

    expect(seenByMax.every((row) => row.userId === max.userId)).toBe(true);
    expect(seenByNobody).toEqual([]);
  });
});
