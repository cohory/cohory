import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, createPool, parseAdminDatabaseEnv, type Database } from "../index";
import { newId } from "../ids";
import { migrationLockKey } from "../migrations";
import { insertUser, openTestDb } from "../test/fixtures";
import {
  communities,
  courses,
  creatorTermsAcceptances,
  memberships,
  migrationJobs,
  notifications,
  pointsLedger,
  postFollows,
  posts,
  subscriberMoves,
  users,
} from "./index";

const probeRole = "cohory_review_w4_probe";
const probeTables = ["post_follows", "creator_terms_acceptances", "subscriber_moves"];
const grantedTables = [...probeTables, "points_ledger_source_cleanup_0035"];

const admin = openTestDb();
const probeUrl = new URL(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
probeUrl.searchParams.set("options", `-c role=${probeRole}`);
const probePool = createPool(probeUrl.toString());
const probeDb = createDb(probePool);

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface Settings {
  community?: string;
  user?: string;
  payments?: boolean;
  webhook?: boolean;
  notificationJobs?: boolean;
}

function asProbe<T>(settings: Settings, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return probeDb.transaction(async (tx) => {
    const set = async (name: string, value: string | undefined) => {
      if (value) await tx.execute(sql`select set_config(${name}, ${value}, true)`);
    };
    await set("app.community_id", settings.community);
    await set("app.user_id", settings.user);
    await set("app.payments_manager", settings.payments ? "on" : undefined);
    await set("app.payments_webhook", settings.webhook ? "on" : undefined);
    await set("app.notification_jobs", settings.notificationJobs ? "on" : undefined);
    return fn(tx);
  });
}

function pgCode(error: unknown): string | undefined {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if ("code" in current && typeof current.code === "string") return current.code;
  }
  return undefined;
}

async function rejectionCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error: unknown) {
    return pgCode(error);
  }
  throw new Error("expected the statement to fail");
}

async function insertCommunity(): Promise<string> {
  const [row] = await admin.db
    .insert(communities)
    .values({ slug: `w4-${newId().slice(-12)}`, name: "Wave four" })
    .returning({ id: communities.id });
  if (!row) throw new Error("community insert returned no row");
  return row.id;
}

async function insertPost(communityId: string, authorId: string): Promise<string> {
  const [row] = await admin.db
    .insert(posts)
    .values({
      communityId,
      authorId,
      body: { type: "doc", content: [] },
      bodyHtml: "",
      bodyText: "",
      excerpt: "",
    })
    .returning({ id: posts.id });
  if (!row) throw new Error("post insert returned no row");
  return row.id;
}

beforeAll(async () => {
  await admin.db.transaction(async (tx) => {
    await tx.execute(sql.raw(`select pg_advisory_xact_lock(${migrationLockKey})`));
    await tx.execute(
      sql.raw(`do $$ begin
        if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
          create role ${probeRole} nologin nosuperuser nobypassrls;
        end if;
        grant usage on schema public to ${probeRole};
        grant select, insert, update, delete on ${grantedTables.join(", ")} to ${probeRole};
      end $$`),
    );
  });
});

afterAll(async () => {
  await probePool.end();
  await admin.close();
});

describe("new tables", () => {
  it.each(probeTables)("has row level security enabled and forced on %s", async (table) => {
    const result = await admin.db.execute<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = ${table}`);

    expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it.each([
    ["post_follows", "post_follows_community_user_idx"],
    ["creator_terms_acceptances", "creator_terms_acceptances_pkey"],
    ["subscriber_moves", "subscriber_moves_community_email_unique"],
    ["subscriber_moves", "subscriber_moves_community_status_idx"],
  ])("indexes %s from community_id with %s", async (table, index) => {
    const result = await admin.db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where tablename = ${table} and indexname = ${index}`,
    );

    expect(result.rows[0]?.indexdef).toMatch(/\(community_id,/);
  });
});

describe("list indexes match their sort", () => {
  it.each([
    "posts_feed_v2_idx",
    "posts_activity_v2_idx",
    "posts_top_v2_idx",
    "posts_category_feed_v2_idx",
    "reviews_community_created_v2_idx",
    "membership_requests_queue_v2_idx",
    "approval_requests_community_state_v2_idx",
    "migration_jobs_community_created_v2_idx",
  ])("%s ends with id desc nulls first", async (index) => {
    const result = await admin.db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = ${index}`,
    );

    expect(result.rows[0]?.indexdef).toMatch(/id DESC\)( WHERE .*)?$/);
    expect(result.rows[0]?.indexdef).not.toMatch(
      /(created_at|last_activity_at|id) DESC NULLS LAST/,
    );
  });

  it("orders the leaderboard index like the leaderboard window", async () => {
    const result = await admin.db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'member_stats_leaderboard_v2_idx'`,
    );

    expect(result.rows[0]?.indexdef).toContain("points_total DESC, updated_at, user_id)");
  });

  it("drops the indexes it replaced", async () => {
    const result = await admin.db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where indexname in ('posts_feed_idx', 'posts_activity_idx', 'posts_top_idx', 'posts_category_feed_idx', 'reviews_community_created_idx', 'membership_requests_queue_idx', 'approval_requests_community_state_idx', 'migration_jobs_community_created_idx', 'member_stats_leaderboard_idx', 'points_ledger_source_reason_unique')`,
    );

    expect(result.rows).toEqual([]);
  });

  it("keeps a partial index of unprocessed provider events for the webhook sweep", async () => {
    const result = await admin.db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'provider_events_unprocessed_idx'`,
    );

    expect(result.rows[0]?.indexdef).toContain("(received_at) WHERE (processed_at IS NULL)");
  });
});

describe("check constraints", () => {
  it("leaves no check constraint unvalidated except the widened 0036 notification check", async () => {
    const result = await admin.db.execute<{ conname: string }>(
      sql`select conname from pg_constraint where contype = 'c' and not convalidated and connamespace = 'public'::regnamespace`,
    );

    expect(result.rows).toEqual([{ conname: "notifications_post_subject" }]);
  });

  it("rejects a course level outside 1 to 9", async () => {
    const communityId = await insertCommunity();

    const code = await rejectionCode(
      admin.db
        .insert(courses)
        .values({ communityId, slug: "locked", title: "Locked", position: 0, requiredLevel: 10 }),
    );

    expect(code).toBe("23514");
  });

  it("rejects terms acceptance time without a terms version", async () => {
    const userId = await insertUser(admin.db);

    const code = await rejectionCode(
      admin.db.update(users).set({ termsAcceptedAt: new Date() }).where(eq(users.id, userId)),
    );

    expect(code).toBe("23514");
  });

  it("rejects a refund line longer than 280 characters", async () => {
    const communityId = await insertCommunity();

    const code = await rejectionCode(
      admin.db
        .update(communities)
        .set({ refundPolicy: "x".repeat(281) })
        .where(eq(communities.id, communityId)),
    );

    expect(code).toBe("23514");
  });
});

describe("points for learning", () => {
  it("gives each member one lesson completion entry per lesson", async () => {
    const communityId = await insertCommunity();
    const first = await insertUser(admin.db);
    const second = await insertUser(admin.db);
    const lessonId = newId();
    const entry = (userId: string) => ({
      communityId,
      userId,
      delta: 5,
      reason: "lesson_completed" as const,
      sourceType: "lesson",
      sourceId: lessonId,
      occurredAt: new Date(),
    });

    await admin.db.insert(pointsLedger).values([entry(first), entry(second)]);
    const code = await rejectionCode(admin.db.insert(pointsLedger).values(entry(first)));

    expect(code).toBe("23505");
  });

  it("accepts event attendance entries per occurrence", async () => {
    const communityId = await insertCommunity();
    const userId = await insertUser(admin.db);

    const [row] = await admin.db
      .insert(pointsLedger)
      .values({
        communityId,
        userId,
        delta: 3,
        reason: "event_attended",
        sourceType: "event_occurrence",
        sourceId: newId(),
        occurredAt: new Date(),
      })
      .returning({ reason: pointsLedger.reason });

    expect(row).toEqual({ reason: "event_attended" });
  });

  it("still keeps one like entry per reaction", async () => {
    const communityId = await insertCommunity();
    const first = await insertUser(admin.db);
    const second = await insertUser(admin.db);
    const reactionId = newId();
    const entry = (userId: string) => ({
      communityId,
      userId,
      delta: 1,
      reason: "like_received" as const,
      sourceType: "reaction",
      sourceId: reactionId,
      occurredAt: new Date(),
    });
    await admin.db.insert(pointsLedger).values(entry(first));

    const code = await rejectionCode(admin.db.insert(pointsLedger).values(entry(second)));

    expect(code).toBe("23505");
  });
});

describe("post follows", () => {
  it("lets a member follow and see only their own follows in the scoped community", async () => {
    const communityId = await insertCommunity();
    const userId = await insertUser(admin.db);
    const otherUser = await insertUser(admin.db);
    const postId = await insertPost(communityId, userId);

    await asProbe({ community: communityId, user: userId }, (tx) =>
      tx.insert(postFollows).values({ communityId, postId, userId }),
    );
    const own = await asProbe({ community: communityId, user: userId }, (tx) =>
      tx.select({ postId: postFollows.postId }).from(postFollows),
    );
    const other = await asProbe({ community: communityId, user: otherUser }, (tx) =>
      tx.select({ postId: postFollows.postId }).from(postFollows),
    );
    const fanout = await asProbe({ community: communityId, notificationJobs: true }, (tx) =>
      tx.select({ userId: postFollows.userId }).from(postFollows),
    );

    expect(own).toEqual([{ postId }]);
    expect(other).toEqual([]);
    expect(fanout).toEqual([{ userId }]);
  });

  it("refuses a follow written for another person", async () => {
    const communityId = await insertCommunity();
    const userId = await insertUser(admin.db);
    const otherUser = await insertUser(admin.db);
    const postId = await insertPost(communityId, userId);

    const code = await rejectionCode(
      asProbe({ community: communityId, user: userId }, (tx) =>
        tx.insert(postFollows).values({ communityId, postId, userId: otherUser }),
      ),
    );

    expect(code).toBe("42501");
  });

  it("hides follows from the notification job of another community", async () => {
    const communityId = await insertCommunity();
    const otherCommunityId = await insertCommunity();
    const userId = await insertUser(admin.db);
    const postId = await insertPost(communityId, userId);
    await admin.db.insert(postFollows).values({ communityId, postId, userId });

    const seen = await asProbe({ community: otherCommunityId, notificationJobs: true }, (tx) =>
      tx.select().from(postFollows).where(eq(postFollows.postId, postId)),
    );

    expect(seen).toEqual([]);
  });

  it("refuses a follow that pairs a post with another community", async () => {
    const communityId = await insertCommunity();
    const otherCommunityId = await insertCommunity();
    const userId = await insertUser(admin.db);
    const postId = await insertPost(communityId, userId);

    const code = await rejectionCode(
      admin.db.insert(postFollows).values({ communityId: otherCommunityId, postId, userId }),
    );

    expect(code).toBe("23503");
  });

  it("goes away with the post", async () => {
    const communityId = await insertCommunity();
    const userId = await insertUser(admin.db);
    const postId = await insertPost(communityId, userId);
    await admin.db.insert(postFollows).values({ communityId, postId, userId });

    await admin.db.delete(posts).where(eq(posts.id, postId));

    const left = await admin.db.select().from(postFollows).where(eq(postFollows.postId, postId));
    expect(left).toEqual([]);
  });

  it("stores a comment on a followed post notification", async () => {
    const communityId = await insertCommunity();
    const userId = await insertUser(admin.db);
    const postId = await insertPost(communityId, userId);

    const [row] = await admin.db
      .insert(notifications)
      .values({
        communityId,
        userId,
        actorId: userId,
        type: "comment_on_followed_post",
        subjectType: "comment",
        subjectId: newId(),
        postId,
      })
      .returning({ type: notifications.type });

    expect(row).toEqual({ type: "comment_on_followed_post" });
  });
});

describe("creator terms acceptances", () => {
  it("records the acting payments manager's acceptance in the scoped community only", async () => {
    const communityId = await insertCommunity();
    const otherCommunityId = await insertCommunity();
    const userId = await insertUser(admin.db);

    await asProbe({ community: communityId, user: userId, payments: true }, (tx) =>
      tx.insert(creatorTermsAcceptances).values({ communityId, userId, version: "2026-10" }),
    );
    const scoped = await asProbe({ community: communityId, payments: true }, (tx) =>
      tx.select({ version: creatorTermsAcceptances.version }).from(creatorTermsAcceptances),
    );
    const elsewhere = await asProbe({ community: otherCommunityId, payments: true }, (tx) =>
      tx.select().from(creatorTermsAcceptances),
    );

    expect(scoped).toEqual([{ version: "2026-10" }]);
    expect(elsewhere).toEqual([]);
  });

  it("refuses an acceptance recorded for someone else or without the payments setting", async () => {
    const communityId = await insertCommunity();
    const userId = await insertUser(admin.db);
    const otherUser = await insertUser(admin.db);

    const forOther = await rejectionCode(
      asProbe({ community: communityId, user: userId, payments: true }, (tx) =>
        tx
          .insert(creatorTermsAcceptances)
          .values({ communityId, userId: otherUser, version: "2026-10" }),
      ),
    );
    const notManager = await rejectionCode(
      asProbe({ community: communityId, user: userId }, (tx) =>
        tx.insert(creatorTermsAcceptances).values({ communityId, userId, version: "2026-10" }),
      ),
    );

    expect(forOther).toBe("42501");
    expect(notManager).toBe("42501");
  });

  it("keeps acceptances append only", async () => {
    const communityId = await insertCommunity();
    const userId = await insertUser(admin.db);
    await admin.db.insert(creatorTermsAcceptances).values({ communityId, userId, version: "v1" });

    const changed = await asProbe({ community: communityId, user: userId, payments: true }, (tx) =>
      tx
        .update(creatorTermsAcceptances)
        .set({ version: "v2" })
        .returning({ version: creatorTermsAcceptances.version }),
    );

    expect(changed).toEqual([]);
  });
});

describe("subscriber moves", () => {
  it("keeps one move per email in a community and is managed by payments managers", async () => {
    const communityId = await insertCommunity();
    const otherCommunityId = await insertCommunity();
    const freeUntil = new Date("2026-11-30T00:00:00Z");

    await asProbe({ community: communityId, payments: true }, (tx) =>
      tx.insert(subscriberMoves).values({
        communityId,
        email: "Member@Example.test",
        wasPaying: true,
        source: "skool",
        freeUntil,
      }),
    );
    const duplicate = await rejectionCode(
      admin.db
        .insert(subscriberMoves)
        .values({ communityId, email: "member@example.test", source: "csv" }),
    );
    const managed = await asProbe({ community: communityId, payments: true }, (tx) =>
      tx
        .select({ status: subscriberMoves.status, freeUntil: subscriberMoves.freeUntil })
        .from(subscriberMoves),
    );
    const member = await asProbe({ community: communityId }, (tx) =>
      tx.select().from(subscriberMoves),
    );
    const elsewhere = await asProbe({ community: otherCommunityId, payments: true }, (tx) =>
      tx.select().from(subscriberMoves),
    );

    expect(duplicate).toBe("23505");
    expect(managed).toEqual([{ status: "pending", freeUntil }]);
    expect(member).toEqual([]);
    expect(elsewhere).toEqual([]);
  });

  it("lets the payments job mark a move resubscribed in the scoped community", async () => {
    const communityId = await insertCommunity();
    const [move] = await admin.db
      .insert(subscriberMoves)
      .values({ communityId, email: `m-${newId()}@example.test`, source: "circle" })
      .returning({ id: subscriberMoves.id });

    const updated = await asProbe({ community: communityId, webhook: true }, (tx) =>
      tx
        .update(subscriberMoves)
        .set({ status: "resubscribed", resubscribedAt: new Date() })
        .where(eq(subscriberMoves.id, move?.id ?? ""))
        .returning({ status: subscriberMoves.status }),
    );

    expect(updated).toEqual([{ status: "resubscribed" }]);
  });

  it("rejects a resubscribed move without the time it happened", async () => {
    const communityId = await insertCommunity();

    const code = await rejectionCode(
      admin.db.insert(subscriberMoves).values({
        communityId,
        email: `m-${newId()}@example.test`,
        source: "manual",
        status: "resubscribed",
      }),
    );

    expect(code).toBe("23514");
  });
});

describe("expand columns", () => {
  it("stores onboarding, welcome email, and feed visit times on a membership", async () => {
    const communityId = await insertCommunity();
    const userId = await insertUser(admin.db);
    const at = new Date("2026-10-22T10:00:00Z");

    const [row] = await admin.db
      .insert(memberships)
      .values({
        communityId,
        userId,
        status: "active",
        onboardingDismissedAt: at,
        welcomeEmailSentAt: at,
        lastFeedVisitAt: at,
      })
      .returning({
        onboardingDismissedAt: memberships.onboardingDismissedAt,
        welcomeEmailSentAt: memberships.welcomeEmailSentAt,
        lastFeedVisitAt: memberships.lastFeedVisitAt,
      });

    expect(row).toEqual({ onboardingDismissedAt: at, welcomeEmailSentAt: at, lastFeedVisitAt: at });
  });

  it("defaults learning points off for a community", async () => {
    const communityId = await insertCommunity();

    const [row] = await admin.db
      .select({
        pointsForLessons: communities.pointsForLessons,
        pointsForEvents: communities.pointsForEvents,
        memberEmailSentAt: communities.memberEmailSentAt,
      })
      .from(communities)
      .where(eq(communities.id, communityId));

    expect(row).toEqual({
      pointsForLessons: false,
      pointsForEvents: false,
      memberEmailSentAt: null,
    });
  });

  it("stores the import email choice and file lifecycle on a migration job", async () => {
    const communityId = await insertCommunity();
    const at = new Date("2026-10-22T10:00:00Z");

    const [row] = await admin.db
      .insert(migrationJobs)
      .values({
        communityId,
        kind: "import",
        status: "succeeded",
        emailChoice: "later",
        expiresAt: at,
        deletedAt: at,
      })
      .returning({
        emailChoice: migrationJobs.emailChoice,
        emailsSentAt: migrationJobs.emailsSentAt,
        expiresAt: migrationJobs.expiresAt,
        deletedAt: migrationJobs.deletedAt,
      });

    expect(row).toEqual({ emailChoice: "later", emailsSentAt: null, expiresAt: at, deletedAt: at });
  });
});

describe("points ledger source cleanup copy", () => {
  it("has row level security on and no policy, so the app role reads nothing", async () => {
    const result = await admin.db.execute<{ relrowsecurity: boolean; policies: number }>(
      sql`select relrowsecurity, (select count(*)::int from pg_policies where tablename = 'points_ledger_source_cleanup_0035') as policies from pg_class where relname = 'points_ledger_source_cleanup_0035'`,
    );
    await admin.db.execute(
      sql`insert into points_ledger_source_cleanup_0035 (ledger_id, community_id, source_type) values (${newId()}, ${newId()}, 'free_text')`,
    );

    const seen = await asProbe({}, (tx) =>
      tx.execute(sql`select ledger_id from points_ledger_source_cleanup_0035`),
    );

    expect(result.rows[0]).toEqual({ relrowsecurity: true, policies: 0 });
    expect(seen.rows).toEqual([]);
  });
});
