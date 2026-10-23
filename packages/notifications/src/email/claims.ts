import { can } from "@cohory/authz";
import type { Database, Transaction } from "@cohory/db";
import {
  communities,
  memberships,
  notificationDeliveries,
  notificationPreferences,
  notifications,
  notificationSettings,
  users,
  type CommunityAppearance,
  type MemberRole,
  type NotificationDeliveryOutcome,
} from "@cohory/db/schema";
import { and, eq, gte, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { setRlsFlag, setRlsValue } from "@cohory/db";

import { defaultEmailMode, defaultTypePreferences, resolvePreferences } from "../preferences";
import {
  deliveredNotificationTypes,
  type DeliveredNotificationType,
  type NotificationSubjectType,
} from "../types";
import {
  digestMaxAgeMs,
  digestMinGapMs,
  immediateHoldMs,
  planEmails,
  type EmailPass,
  type PendingNotification,
} from "./plan";

const scanLimit = 500;
const scanWindowMs = digestMaxAgeMs + 60 * 60 * 1000;
// A role based join request stays in the right away scan only briefly, so requests that the
// claim defers to the daily summary do not fill the scan and starve other people's email.
const roleDefaultImmediateMs = immediateHoldMs + 12 * 60 * 1000;

export interface Candidate extends PendingNotification {
  readonly subjectType: NotificationSubjectType;
  readonly subjectId: string;
  readonly role: MemberRole | null;
  readonly detail: string | null;
  readonly actorName: string;
  readonly communityName: string | null;
  readonly communitySlug: string | null;
  readonly communityAppearance: CommunityAppearance | null;
  readonly visible: boolean;
}

export type Group = readonly [Candidate, ...Candidate[]];

export interface Recipient {
  readonly email: string;
  readonly name: string;
  readonly reachable: boolean;
}

const delivered = inArray(notifications.type, [...deliveredNotificationTypes]);

function emailModeSql(): SQL {
  const cases = deliveredNotificationTypes.map(
    (type) => sql`when ${type} then ${defaultTypePreferences[type].email}`,
  );
  return sql`coalesce(${notificationPreferences.email}::text, case ${notifications.type}::text ${sql.join(cases, sql` `)} end)`;
}

// The scan cannot read memberships, so a join request on its role based default is
// picked up by both passes and the claim decides with the recipient's role.
const roleDefaultSql = sql`(${notificationPreferences.email} is null and ${notifications.type} = 'join_request')`;

// A join request email is only for someone whose current role may still approve it.
function canApprove(userId: string, role: MemberRole | null): boolean {
  return can({ kind: "user", userId, platformAdmin: false }, "approve", "membership", { role });
}

function isDeliveredType(type: string): type is DeliveredNotificationType {
  return (deliveredNotificationTypes as readonly string[]).includes(type);
}

export interface Claimed {
  readonly recipient: Recipient | null;
  readonly immediate: readonly Group[];
  readonly digest: readonly Candidate[];
  readonly skipped: number;
  readonly previousDigestAt: Date | null;
}

export function createEmailClaims(db: Database) {
  async function asJob<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await setRlsFlag(tx, "notification_jobs");
      return fn(tx);
    });
  }

  async function asUser<T>(userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await setRlsValue(tx, "user_id", userId);
      return fn(tx);
    });
  }

  async function scan(pass: EmailPass, at: Date, limit = scanLimit): Promise<string[]> {
    const mode = emailModeSql();
    const roleDefaultSince = new Date(at.getTime() - roleDefaultImmediateMs).toISOString();
    const passCondition =
      pass === "immediate"
        ? sql`((${mode} <> 'daily' and not ${roleDefaultSql}) or (${roleDefaultSql} and ${notifications.createdAt} >= ${roleDefaultSince}::timestamptz))`
        : sql`(${mode} = 'daily' or ${roleDefaultSql})
            and extract(hour from (${at.toISOString()}::timestamptz at time zone coalesce(${notificationSettings.timeZone}, 'UTC'))) = coalesce(${notificationSettings.digestHour}, 8)
            and (${notificationSettings.lastDigestAt} is null or ${notificationSettings.lastDigestAt} <= ${new Date(at.getTime() - digestMinGapMs).toISOString()}::timestamptz)`;
    return asJob(async (tx) => {
      const rows = await tx
        .select({ userId: notifications.userId })
        .from(notifications)
        .leftJoin(
          notificationPreferences,
          and(
            eq(notificationPreferences.userId, notifications.userId),
            eq(notificationPreferences.type, notifications.type),
          ),
        )
        .leftJoin(notificationSettings, eq(notificationSettings.userId, notifications.userId))
        .where(
          and(
            delivered,
            gte(notifications.createdAt, new Date(at.getTime() - scanWindowMs)),
            sql`not exists (select 1 from ${notificationDeliveries} where ${notificationDeliveries.notificationId} = ${notifications.id} and ${notificationDeliveries.channel} = 'email')`,
            passCondition,
          ),
        )
        .groupBy(notifications.userId)
        .orderBy(sql`min(${notifications.createdAt})`)
        .limit(limit);
      return rows.map((row) => row.userId);
    });
  }

  async function loadRecipient(tx: Transaction, userId: string): Promise<Recipient | null> {
    const [row] = await tx
      .select({
        email: users.email,
        name: users.name,
        emailVerified: users.emailVerified,
        deletionScheduledFor: users.deletionScheduledFor,
        erasedAt: users.erasedAt,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (!row) {
      return null;
    }
    return {
      email: row.email,
      name: row.name,
      reachable: row.emailVerified && row.deletionScheduledFor === null && row.erasedAt === null,
    };
  }

  async function loadCandidates(tx: Transaction, userId: string, at: Date): Promise<Candidate[]> {
    const rows = await tx
      .select({
        id: notifications.id,
        type: notifications.type,
        communityId: notifications.communityId,
        subjectType: notifications.subjectType,
        subjectId: notifications.subjectId,
        postId: notifications.postId,
        detail: notifications.detail,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        actorName: sql<string>`(select ${users.name} from ${users} where ${users.id} = ${notifications.actorId})`,
        communityName: communities.name,
        communitySlug: communities.slug,
        communityAppearance: communities.appearance,
        membershipStatus: memberships.status,
        role: memberships.role,
      })
      .from(notifications)
      .leftJoin(
        communities,
        and(eq(communities.id, notifications.communityId), isNull(communities.deletedAt)),
      )
      .leftJoin(
        memberships,
        and(
          eq(memberships.communityId, notifications.communityId),
          eq(memberships.userId, notifications.userId),
        ),
      )
      .where(
        and(
          eq(notifications.userId, userId),
          delivered,
          gte(notifications.createdAt, new Date(at.getTime() - scanWindowMs)),
          sql`not exists (select 1 from ${notificationDeliveries} where ${notificationDeliveries.notificationId} = ${notifications.id} and ${notificationDeliveries.channel} = 'email')`,
        ),
      );
    const candidates: Candidate[] = [];
    for (const row of rows) {
      if (!isDeliveredType(row.type)) {
        continue;
      }
      candidates.push({
        id: row.id,
        type: row.type,
        communityId: row.communityId,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        role: row.role,
        postId: row.postId,
        detail: row.detail,
        readAt: row.readAt,
        createdAt: row.createdAt,
        actorName: row.actorName,
        communityName: row.communityName,
        communitySlug: row.communitySlug,
        communityAppearance: row.communityAppearance,
        visible:
          row.communitySlug !== null &&
          (row.membershipStatus === "active" ||
            (row.type === "join_request_declined" && row.membershipStatus !== "banned")) &&
          (row.type !== "join_request" || canApprove(userId, row.role)),
      });
    }
    return candidates;
  }

  async function record(
    tx: Transaction,
    userId: string,
    items: readonly Candidate[],
    outcome: NotificationDeliveryOutcome,
  ): Promise<Set<string>> {
    if (items.length === 0) {
      return new Set();
    }
    const inserted = await tx
      .insert(notificationDeliveries)
      .values(
        items.map((n) => ({ notificationId: n.id, userId, channel: "email" as const, outcome })),
      )
      .onConflictDoNothing()
      .returning({ notificationId: notificationDeliveries.notificationId });
    return new Set(inserted.map((row) => row.notificationId));
  }

  async function release(userId: string, ids: readonly string[], lastDigestAt?: Date | null) {
    await asUser(userId, async (tx) => {
      await tx
        .delete(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.userId, userId),
            inArray(notificationDeliveries.notificationId, [...ids]),
          ),
        );
      if (lastDigestAt !== undefined) {
        await tx
          .update(notificationSettings)
          .set({ lastDigestAt })
          .where(eq(notificationSettings.userId, userId));
      }
    });
  }

  async function claim(pass: EmailPass, userId: string, at: Date): Promise<Claimed> {
    return asUser(userId, async (tx) => {
      const recipient = await loadRecipient(tx, userId);
      const [prefRows, [settings], candidates] = await Promise.all([
        tx
          .select({
            type: notificationPreferences.type,
            inApp: notificationPreferences.inApp,
            email: notificationPreferences.email,
          })
          .from(notificationPreferences)
          .where(eq(notificationPreferences.userId, userId)),
        tx.select().from(notificationSettings).where(eq(notificationSettings.userId, userId)),
        loadCandidates(tx, userId, at),
      ]);
      const preferences = resolvePreferences(prefRows, settings ?? null);
      const chosen = new Set(prefRows.map((row) => row.type));
      const previousDigestAt = settings?.lastDigestAt ?? null;
      const hidden = candidates.filter(
        (n) => !n.visible || recipient === null || !recipient.reachable,
      );
      const plan = planEmails({
        pass,
        pending: candidates
          .filter((n) => !hidden.includes(n))
          .map((n) =>
            chosen.has(n.type) ? n : { ...n, emailMode: defaultEmailMode(n.type, n.role) },
          ),
        preferences,
        lastDigestAt: previousDigestAt,
        now: at,
      });
      const skipped = await record(tx, userId, [...hidden, ...plan.skip], "skipped");
      const claimedIds = await record(
        tx,
        userId,
        [...plan.immediate.flat(), ...plan.digest],
        "sent",
      );
      const digest = plan.digest.filter((n) => claimedIds.has(n.id));
      if (digest.length > 0) {
        await tx
          .insert(notificationSettings)
          .values({
            userId,
            digestHour: preferences.digestHour,
            timeZone: preferences.timeZone,
            lastDigestAt: at,
          })
          .onConflictDoUpdate({ target: notificationSettings.userId, set: { lastDigestAt: at } });
      }
      return {
        recipient,
        immediate: plan.immediate.flatMap((group): Group[] => {
          const [first, ...rest] = group.filter((n) => claimedIds.has(n.id));
          return first ? [[first, ...rest]] : [];
        }),
        digest,
        skipped: skipped.size,
        previousDigestAt,
      };
    });
  }

  return { scan, claim, release };
}
