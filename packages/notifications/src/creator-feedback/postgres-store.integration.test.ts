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
import { communities, creatorFeedback, notificationSettings, users } from "@cohory/db/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresCreatorFeedbackStore } from "./postgres-store";
import { createCreatorFeedbackService } from "./service";

const probeRole = "cohory_creator_feedback_probe";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const adminPool = createPool(adminUrl);
const adminDb = createDb(adminPool);
const appUrl = new URL(adminUrl);
appUrl.searchParams.set("options", `-c role=${probeRole}`);
const appPool = createPool(appUrl.toString());
const appDb = createDb(appPool);
const store = createPostgresCreatorFeedbackStore(appDb);
const day = 24 * 60 * 60 * 1000;

async function newUser(name: string): Promise<string> {
  const [row] = await adminDb
    .insert(users)
    .values({ name, email: `feedback-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

async function newCommunity(ownerId: string, adminId?: string): Promise<CommunityId> {
  const community = await createCommunity(adminDb, {
    slug: communitySlugSchema.parse(`feedback-${newId().slice(-12)}`),
    name: "Feedback",
  });
  const scope = withCommunity(adminDb, community.id);
  await addMembership(scope, { userId: ownerId, role: "owner", status: "active" });
  if (adminId) await addMembership(scope, { userId: adminId, role: "admin", status: "active" });
  return community.id;
}

function pgCode(error: unknown): string | undefined {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if ("code" in current && typeof current.code === "string") return current.code;
  }
  return undefined;
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
    grant select, insert, update, delete on memberships, creator_feedback, notification_settings to ${probeRole};
  `),
  );
});

afterAll(async () => {
  await appPool.end();
  await adminPool.end();
});

describe("creator_feedback table", () => {
  it("has row level security enabled and forced", async () => {
    const result = await adminDb.execute<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'creator_feedback'`,
    );

    expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("shows a creator only their own rows and nothing without app.user_id", async () => {
    const ada = await newUser("Ada");
    const bob = await newUser("Bob");
    const community = await newCommunity(ada);
    await store.insertPendingMoment({
      userId: ada,
      communityId: community,
      moment: "first_post",
      at: new Date(),
    });

    const anonymous = await appDb.select().from(creatorFeedback);
    const asBob = await appDb.transaction(async (tx) => {
      await setRlsValue(tx, "user_id", bob);
      return tx.select().from(creatorFeedback).where(eq(creatorFeedback.communityId, community));
    });
    const asAda = await appDb.transaction(async (tx) => {
      await setRlsValue(tx, "user_id", ada);
      return tx.select().from(creatorFeedback).where(eq(creatorFeedback.communityId, community));
    });

    expect(anonymous).toEqual([]);
    expect(asBob).toEqual([]);
    expect(asAda).toHaveLength(1);
  });

  it("refuses a row for another user or for a community other than app.community_id", async () => {
    const ada = await newUser("Ada");
    const bob = await newUser("Bob");
    const mine = await newCommunity(ada);
    const theirs = await newCommunity(bob);
    const row = {
      kind: "exit" as const,
      topic: "archive_community" as const,
      status: "answered" as const,
      reason: "other" as const,
      respondedAt: new Date(),
    };

    const forOther = appDb.transaction(async (tx) => {
      await setRlsValue(tx, "user_id", ada);
      await setRlsValue(tx, "community_id", mine);
      await tx.insert(creatorFeedback).values({ ...row, userId: bob, communityId: mine });
    });
    const crossTenant = appDb.transaction(async (tx) => {
      await setRlsValue(tx, "user_id", ada);
      await setRlsValue(tx, "community_id", mine);
      await tx.insert(creatorFeedback).values({ ...row, userId: ada, communityId: theirs });
    });

    expect(pgCode(await forOther.catch((error: unknown) => error))).toBe("42501");
    expect(pgCode(await crossTenant.catch((error: unknown) => error))).toBe("42501");
  });

  it("keeps one moment row per community", async () => {
    const ada = await newUser("Ada");
    const community = await newCommunity(ada);
    const at = new Date();

    expect(
      await store.insertPendingMoment({
        userId: ada,
        communityId: community,
        moment: "first_course",
        at,
      }),
    ).toBe(true);
    expect(
      await store.insertPendingMoment({
        userId: ada,
        communityId: community,
        moment: "first_course",
        at,
      }),
    ).toBe(false);
  });

  it("keeps the row without its community when the community is deleted", async () => {
    const ada = await newUser("Ada");
    const community = await newCommunity(ada);
    await store.insertExit({
      userId: ada,
      communityId: community,
      action: "delete_community",
      reason: "only_testing",
      comment: null,
      at: new Date(),
    });

    await adminDb.delete(communities).where(eq(communities.id, community));

    const rows = await adminDb
      .select({ communityId: creatorFeedback.communityId, reason: creatorFeedback.reason })
      .from(creatorFeedback)
      .where(eq(creatorFeedback.userId, ada));
    expect(rows).toEqual([{ communityId: null, reason: "only_testing" }]);
  });

  it("lets the retention sweep remove only rows older than 24 months", async () => {
    const ada = await newUser("Ada");
    const answer = { userId: ada, communityId: null, action: "delete_account" as const };
    await store.insertExit({
      ...answer,
      reason: "other",
      comment: null,
      at: new Date(Date.now() - 25 * 31 * day),
    });
    await store.insertExit({ ...answer, reason: "only_testing", comment: null, at: new Date() });

    const removed = await store.removeCreatedBefore(new Date(Date.now() + day));

    expect(removed).toBeGreaterThanOrEqual(1);
    const rows = await adminDb
      .select({ reason: creatorFeedback.reason })
      .from(creatorFeedback)
      .where(eq(creatorFeedback.userId, ada));
    expect(rows).toEqual([{ reason: "only_testing" }]);
  });
});

describe("postgres creator feedback store", () => {
  it("reads the viewer's role and the community owner", async () => {
    const ada = await newUser("Ada");
    const ben = await newUser("Ben");
    const community = await newCommunity(ada, ben);

    expect(await store.standingIn(ben, community)).toMatchObject({ role: "admin" });
    expect(await store.standingIn(await newUser("Cy"), community)).toMatchObject({ role: null });
    expect(await store.ownerOf(community)).toMatchObject({ userId: ada });
  });

  it("offers the oldest pending moment only in a community the creator still owns", async () => {
    const ada = await newUser("Ada");
    const ben = await newUser("Ben");
    const first = await newCommunity(ada, ben);
    const second = await newCommunity(ada);
    const now = Date.now();
    await store.insertPendingMoment({
      userId: ada,
      communityId: first,
      moment: "first_post",
      at: new Date(now - 2 * day),
    });
    await store.insertPendingMoment({
      userId: ada,
      communityId: second,
      moment: "first_post",
      at: new Date(now - day),
    });

    expect(await store.oldestPendingMoment(ada, new Date(now - 90 * day))).toEqual({
      communityId: first,
      moment: "first_post",
    });

    await adminDb.execute(
      sql`update memberships set role = 'admin' where community_id = ${first} and user_id = ${ada}`,
    );
    expect(await store.oldestPendingMoment(ada, new Date(now - 90 * day))).toEqual({
      communityId: second,
      moment: "first_post",
    });
  });

  it("records a response once and reports when it was given", async () => {
    const ada = await newUser("Ada");
    const community = await newCommunity(ada);
    const at = new Date("2026-10-20T10:00:00.000Z");
    await store.insertPendingMoment({
      userId: ada,
      communityId: community,
      moment: "first_paid_member",
      at,
    });

    const answer = {
      userId: ada,
      communityId: community,
      moment: "first_paid_member" as const,
      status: "answered" as const,
      score: 4,
      comment: "Fine",
      at,
    };
    expect(await store.respondToMoment(answer)).toBe(true);
    expect(await store.respondToMoment(answer)).toBe(false);
    expect(await store.lastMomentResponseAt(ada)).toEqual(at);
  });

  it("stores account deletion reasons without a community and the opt out on notification settings", async () => {
    const ada = await newUser("Ada");
    const at = new Date("2026-10-21T10:00:00.000Z");

    await store.insertExit({
      userId: ada,
      communityId: null,
      action: "delete_account",
      reason: null,
      comment: "Bye",
      at,
    });
    await store.setOptedOut(ada, at);
    expect(await store.optedOutAt(ada)).toEqual(at);
    await store.setOptedOut(ada, null);

    expect(await store.optedOutAt(ada)).toBeNull();
    const [settings] = await adminDb
      .select({ at: notificationSettings.creatorFeedbackOptedOutAt })
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, ada));
    expect(settings).toEqual({ at: null });
    const rows = await adminDb
      .select()
      .from(creatorFeedback)
      .where(eq(creatorFeedback.userId, ada));
    expect(rows).toMatchObject([{ communityId: null, topic: "delete_account", comment: "Bye" }]);
  });

  it("drives the 30 day cap through the service against the database", async () => {
    const ada = await newUser("Ada");
    const first = await newCommunity(ada);
    const second = await newCommunity(ada);
    let clock = Date.now();
    const service = createCreatorFeedbackService({
      store,
      outbox: { send: async () => undefined },
      contactEmail: null,
      edition: "cloud",
      instanceUrl: "https://cohory.example.com",
      isFirstMoment: async () => true,
      now: () => new Date(clock),
    });
    const actor = { kind: "user" as const, userId: ada, platformAdmin: false };
    await service.recordMoment({ communityId: first, moment: "first_post" });
    clock += 1000;
    await service.recordMoment({ communityId: second, moment: "first_course" });

    expect(await service.nextQuestion(actor, first)).toMatchObject({ moment: "first_post" });
    await service.respond(actor, {
      communityId: first,
      moment: "first_post",
      outcome: "dismissed",
    });
    clock += 10 * day;
    expect(await service.nextQuestion(actor, second)).toBeNull();
    clock += 21 * day;
    expect(await service.nextQuestion(actor, second)).toMatchObject({ moment: "first_course" });
  });
});
