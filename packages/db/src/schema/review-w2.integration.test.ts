import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setRlsValue } from "../tenancy/session";

import { createDb, createPool, parseAdminDatabaseEnv, type Database } from "../index";
import { newId } from "../ids";
import { migrationLockKey } from "../migrations";
import { insertUser, openTestDb } from "../test/fixtures";
import {
  communities,
  emailLog,
  emailSuppressions,
  membershipPlans,
  notifications,
  pendingJoinAnswers,
  pointsLedger,
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhookEndpoints,
} from "./index";

const probeRole = "cohory_review_w2_probe";
const probeTables = [
  "communities",
  "points_ledger",
  "notifications",
  "email_log",
  "email_suppressions",
  "pending_join_answers",
  "webhook_delivery_attempts",
];

const admin = openTestDb();
const probeUrl = new URL(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
probeUrl.searchParams.set("options", `-c role=${probeRole}`);
const probePool = createPool(probeUrl.toString());
const probeDb = createDb(probePool);

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface Settings {
  community?: string;
  user?: string;
  purge?: boolean;
  email?: boolean;
  webhook?: boolean;
}

function asProbe<T>(settings: Settings, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return probeDb.transaction(async (tx) => {
    const set = async (name: string, value: string | undefined) => {
      if (value) await tx.execute(sql`select set_config(${name}, ${value}, true)`);
    };
    await set("app.community_id", settings.community);
    await set("app.user_id", settings.user);
    await set("app.community_purge", settings.purge ? "on" : undefined);
    await set("app.email_delivery", settings.email ? "on" : undefined);
    await set("app.payments_webhook", settings.webhook ? "on" : undefined);
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
    .values({ slug: `w2-${newId().slice(-12)}`, name: "Wave two" })
    .returning({ id: communities.id });
  if (!row) throw new Error("community insert returned no row");
  return row.id;
}

async function insertLedgerRow(communityId: string, userId: string): Promise<string> {
  const [row] = await admin.db
    .insert(pointsLedger)
    .values({
      communityId,
      userId,
      delta: 1,
      reason: "like_received",
      sourceType: "reaction",
      sourceId: newId(),
      occurredAt: new Date(),
    })
    .returning({ id: pointsLedger.id });
  if (!row) throw new Error("ledger insert returned no row");
  return row.id;
}

async function insertCommunityNotification(communityId: string, userId: string): Promise<string> {
  const [row] = await admin.db
    .insert(notifications)
    .values({
      communityId,
      userId,
      actorId: userId,
      type: "ownership_transferred",
      subjectType: "community",
      subjectId: communityId,
    })
    .returning({ id: notifications.id });
  if (!row) throw new Error("notification insert returned no row");
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
        grant select, insert, update, delete on ${probeTables.join(", ")} to ${probeRole};
      end $$`),
    );
  });
});

afterAll(async () => {
  await probePool.end();
  await admin.close();
});

describe("new tables", () => {
  it.each(["email_log", "email_suppressions", "pending_join_answers", "webhook_delivery_attempts"])(
    "has row level security enabled and forced on %s",
    async (table) => {
      const result = await admin.db.execute<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = ${table}`);

      expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    },
  );
});

describe("indexes", () => {
  it.each([
    ["comments", "comments_post_id_idx"],
    ["notifications", "notifications_post_id_idx"],
    ["notifications", "notifications_user_created_idx"],
    ["notifications", "notifications_actor_id_idx"],
    ["memberships", "memberships_community_directory_idx"],
    ["points_ledger", "points_ledger_admin_reset_idx"],
    ["payments", "payments_subscription_id_idx"],
    ["subscriptions", "subscriptions_customer_id_idx"],
    ["subscriptions", "subscriptions_connection_id_idx"],
    ["subscriptions", "subscriptions_plan_id_idx"],
    ["fee_ledger_entries", "fee_ledger_entries_payment_id_idx"],
    ["membership_plans", "membership_plans_connection_id_idx"],
    ["provider_events", "provider_events_connection_id_idx"],
    ["audit_log", "audit_log_actor_id_idx"],
    ["invite_links", "invite_links_created_by_idx"],
    ["communities", "communities_purge_queue_idx"],
  ])("indexes %s with %s", async (table, index) => {
    const result = await admin.db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where tablename = ${table} and indexname = ${index}`,
    );

    expect(result.rows).toHaveLength(1);
  });
});

describe("list indexes match a descending sort", () => {
  it.each([
    "notifications_user_created_idx",
    "webhook_deliveries_endpoint_idx",
    "memberships_community_directory_idx",
  ])("%s keeps nulls first like ORDER BY ... DESC", async (index) => {
    const result = await admin.db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = ${index}`,
    );

    expect(result.rows[0]?.indexdef).toContain("id DESC)");
    expect(result.rows[0]?.indexdef).not.toContain("NULLS LAST");
  });
});

describe("points ledger source type", () => {
  it("rejects a source type outside the known list", async () => {
    const communityId = await insertCommunity();
    const userId = await insertUser(admin.db);

    const code = await rejectionCode(
      admin.db.insert(pointsLedger).values({
        communityId,
        userId,
        delta: 1,
        reason: "like_received",
        sourceType: "free_text",
        sourceId: newId(),
        occurredAt: new Date(),
      }),
    );

    expect(code).toBe("23514");
  });
});

describe("community purge delete policies", () => {
  it("deletes nothing from points ledger or notifications without the purge setting", async () => {
    const communityId = await insertCommunity();
    const userId = await insertUser(admin.db);
    await insertLedgerRow(communityId, userId);
    await insertCommunityNotification(communityId, userId);
    const otherUser = await insertUser(admin.db);

    const deleted = await asProbe({ community: communityId, user: otherUser }, async (tx) => ({
      ledger: await tx
        .delete(pointsLedger)
        .where(eq(pointsLedger.communityId, communityId))
        .returning({ id: pointsLedger.id }),
      notifications: await tx
        .delete(notifications)
        .where(eq(notifications.communityId, communityId))
        .returning({ id: notifications.id }),
    }));

    expect(deleted).toEqual({ ledger: [], notifications: [] });
  });

  it("deletes only the scoped community's rows with the purge setting", async () => {
    const communityId = await insertCommunity();
    const otherCommunityId = await insertCommunity();
    const userId = await insertUser(admin.db);
    const ledgerId = await insertLedgerRow(communityId, userId);
    const otherLedgerId = await insertLedgerRow(otherCommunityId, userId);
    const notificationId = await insertCommunityNotification(communityId, userId);
    const otherNotificationId = await insertCommunityNotification(otherCommunityId, userId);

    const deleted = await asProbe({ community: communityId, purge: true }, async (tx) => ({
      ledger: await tx.delete(pointsLedger).returning({ id: pointsLedger.id }),
      notifications: await tx.delete(notifications).returning({ id: notifications.id }),
    }));

    expect(deleted).toEqual({
      ledger: [{ id: ledgerId }],
      notifications: [{ id: notificationId }],
    });
    const left = await admin.db.execute<{ id: string }>(
      sql`select id from points_ledger where id = ${otherLedgerId} union all select id from notifications where id = ${otherNotificationId}`,
    );
    expect(left.rows).toHaveLength(2);
  });
});

describe("communities purge attempts", () => {
  it("records the last purge attempt", async () => {
    const communityId = await insertCommunity();
    const at = new Date("2026-10-22T10:00:00Z");

    await admin.db
      .update(communities)
      .set({ purgeAttemptedAt: at })
      .where(eq(communities.id, communityId));

    const [row] = await admin.db
      .select({ purgeAttemptedAt: communities.purgeAttemptedAt })
      .from(communities)
      .where(eq(communities.id, communityId));
    expect(row?.purgeAttemptedAt).toEqual(at);
  });
});

describe("draft plans", () => {
  it("saves a plan before any payment connection exists", async () => {
    const communityId = await insertCommunity();

    const [plan] = await admin.db
      .insert(membershipPlans)
      .values({ communityId, name: "Members", currency: "usd", monthlyPriceMinor: 1000 })
      .returning({ connectionId: membershipPlans.connectionId });

    expect(plan).toEqual({ connectionId: null });
  });
});

describe("notifications for later waves", () => {
  it.each([
    ["member_joined", "community"],
    ["paid_member_joined", "community"],
    ["paid_member_canceled", "community"],
    ["member_payment_failed", "community"],
    ["report_created", "report"],
    ["event_created", "event"],
    ["event_reminder", "event"],
    ["token_expiring", "api_token"],
  ] as const)("stores a %s notification about a %s without a post", async (type, subjectType) => {
    const communityId = await insertCommunity();
    const userId = await insertUser(admin.db);

    const [row] = await admin.db
      .insert(notifications)
      .values({ communityId, userId, actorId: userId, type, subjectType, subjectId: newId() })
      .returning({ type: notifications.type });

    expect(row).toEqual({ type });
  });
});

describe("webhook endpoint secret roll", () => {
  it("rejects a previous secret without an expiry", async () => {
    const communityId = await insertCommunity();

    const code = await rejectionCode(
      admin.db.insert(webhookEndpoints).values({
        communityId,
        url: "https://example.test/hook",
        eventTypes: ["post.created"],
        secretCiphertext: "current",
        previousSecretCiphertext: "previous",
      }),
    );

    expect(code).toBe("23514");
  });
});

describe("webhook delivery attempts", () => {
  it("are visible to the community's webhook manager only", async () => {
    const communityId = await insertCommunity();
    const otherCommunityId = await insertCommunity();
    const [endpoint] = await admin.db
      .insert(webhookEndpoints)
      .values({
        communityId,
        url: "https://example.test/hook",
        eventTypes: ["post.created"],
        secretCiphertext: "current",
      })
      .returning({ id: webhookEndpoints.id });
    const [delivery] = await admin.db
      .insert(webhookDeliveries)
      .values({
        communityId,
        endpointId: endpoint?.id ?? "",
        eventId: newId(),
        eventType: "post.created",
        payload: { type: "post.created", timestamp: "2026-10-22T10:00:00Z", data: {} },
        nextAttemptAt: new Date(),
      })
      .returning({ id: webhookDeliveries.id });
    await admin.db.insert(webhookDeliveryAttempts).values({
      communityId,
      deliveryId: delivery?.id ?? "",
      requestHeaders: { "webhook-id": "msg_1" },
      requestBody: "{}",
      responseStatus: 500,
      responseBodyExcerpt: "oops",
    });

    const seen = async (community: string, manager: boolean) =>
      probeDb.transaction(async (tx) => {
        await setRlsValue(tx, "community_id", community);
        if (manager) await tx.execute(sql`select set_config('app.webhooks_manager', 'on', true)`);
        return tx
          .select({ status: webhookDeliveryAttempts.responseStatus })
          .from(webhookDeliveryAttempts)
          .where(eq(webhookDeliveryAttempts.deliveryId, delivery?.id ?? ""));
      });

    expect(await seen(communityId, true)).toEqual([{ status: 500 }]);
    expect(await seen(communityId, false)).toEqual([]);
    expect(await seen(otherCommunityId, true)).toEqual([]);
  });
});

describe("pending join answers", () => {
  it("lets a person write and read only their own answers in the scoped community", async () => {
    const communityId = await insertCommunity();
    const userId = await insertUser(admin.db);
    const otherUser = await insertUser(admin.db);
    const answers = [{ question: "Why join?", answer: "To learn" }];

    await asProbe({ community: communityId, user: userId }, (tx) =>
      tx.insert(pendingJoinAnswers).values({ communityId, userId, answers }),
    );

    const own = await asProbe({ community: communityId, user: userId }, (tx) =>
      tx.select({ answers: pendingJoinAnswers.answers }).from(pendingJoinAnswers),
    );
    const other = await asProbe({ community: communityId, user: otherUser }, (tx) =>
      tx.select({ answers: pendingJoinAnswers.answers }).from(pendingJoinAnswers),
    );
    const activation = await asProbe({ community: communityId, webhook: true }, (tx) =>
      tx
        .delete(pendingJoinAnswers)
        .where(eq(pendingJoinAnswers.userId, userId))
        .returning({ answers: pendingJoinAnswers.answers }),
    );
    expect(own).toEqual([{ answers }]);
    expect(other).toEqual([]);
    expect(activation).toEqual([{ answers }]);
  });

  it("refuses answers written for another person", async () => {
    const communityId = await insertCommunity();
    const userId = await insertUser(admin.db);
    const otherUser = await insertUser(admin.db);

    const code = await rejectionCode(
      asProbe({ community: communityId, user: userId }, (tx) =>
        tx.insert(pendingJoinAnswers).values({ communityId, userId: otherUser, answers: [] }),
      ),
    );

    expect(code).toBe("42501");
  });
});

describe("email tables", () => {
  const hash = "a".repeat(64);

  it("hides the send log and suppression list without the email delivery setting", async () => {
    await admin.db
      .insert(emailLog)
      .values({ template: "invite", recipientHash: hash, status: "sent" });
    await admin.db
      .insert(emailSuppressions)
      .values({ addressHash: hash, reason: "manual", source: "operator" })
      .onConflictDoNothing();

    const hidden = await asProbe({}, async (tx) => ({
      log: await tx.select().from(emailLog),
      suppressions: await tx.select().from(emailSuppressions),
    }));
    const visible = await asProbe({ email: true }, async (tx) => ({
      log: await tx.select().from(emailLog).where(eq(emailLog.recipientHash, hash)),
      suppressions: await tx
        .select()
        .from(emailSuppressions)
        .where(eq(emailSuppressions.addressHash, hash)),
    }));

    expect(hidden).toEqual({ log: [], suppressions: [] });
    expect(visible.log.length).toBeGreaterThan(0);
    expect(visible.suppressions).toHaveLength(1);
  });

  it("keeps one instance wide and one community suppression per address", async () => {
    const communityId = await insertCommunity();
    const address = newId().replaceAll("-", "").padEnd(64, "0");
    await admin.db
      .insert(emailSuppressions)
      .values({ addressHash: address, reason: "hard_bounce", source: "smtp" });
    await admin.db
      .insert(emailSuppressions)
      .values({ addressHash: address, communityId, reason: "opt_out", source: "member" });

    const code = await rejectionCode(
      admin.db
        .insert(emailSuppressions)
        .values({ addressHash: address, communityId, reason: "manual", source: "operator" }),
    );

    expect(code).toBe("23505");
  });

  it("rejects an address hash that is not a sha256 hex digest", async () => {
    const code = await rejectionCode(
      admin.db
        .insert(emailSuppressions)
        .values({ addressHash: "person@example.test", reason: "manual", source: "operator" }),
    );

    expect(code).toBe("23514");
  });
});
