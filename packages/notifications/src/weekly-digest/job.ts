import {
  getDb,
  parseCommunityId,
  runInCommunity,
  setRlsFlag,
  setRlsValue,
  withCommunity,
  type Database,
  type Transaction,
} from "@cohory/db";
import {
  communities,
  memberships,
  notifications,
  notificationSettings,
  users,
  type CommunityAppearance,
} from "@cohory/db/schema";
import {
  communityEmailBrand,
  sendEmail,
  weeklyDigestEmail,
  type EmailMessage,
  type WeeklyDigestCommunity,
} from "@cohory/email";
import { getCommunityAccess } from "@cohory/entitlements/access";
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";

import { defaultDigestHour, defaultTimeZone, defaultWeeklyDigest } from "../preferences";
import { createUnsubscribeToken, unsubscribeSecretFromEnv } from "../unsubscribe";
import {
  composeCommunity,
  isWeeklyDigestDue,
  weekMs,
  weeklyDigestMemberNames,
  weeklyDigestMinGapMs,
  weeklyDigestMinPosts,
  type DigestFeed,
  type DigestMembers,
  type DigestMoney,
  type WeeklyDigestSource,
} from "./compose";

export const notificationsWeeklyDigestJob = "notifications.weekly-digest";
export const notificationsWeeklyDigestCron = "*/15 * * * *";

const scanPageSize = 200;

export interface WeeklyDigestJobDeps {
  readonly db: Database;
  readonly source: WeeklyDigestSource;
  readonly send: (message: EmailMessage) => Promise<void>;
  readonly appUrl: string;
  readonly secret: string;
  readonly now?: () => Date;
  readonly onError?: (error: unknown, userId: string) => void;
}

export interface WeeklyDigestRunResult {
  readonly users: number;
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
}

interface Settings {
  readonly digestHour: number;
  readonly timeZone: string;
  readonly lastWeeklyDigestAt: Date | null;
}

interface MemberCommunity {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly role: string;
  readonly joinedAt: Date | null;
  readonly appearance: CommunityAppearance | null;
}

interface RecentMembers {
  readonly count: number;
  readonly newest: readonly { readonly userId: string; readonly name: string }[];
}

interface RunCache {
  readonly feeds: Map<string, DigestFeed | null>;
  readonly members: Map<string, RecentMembers>;
}

interface Prepared {
  readonly email: string;
  readonly name: string;
  readonly settings: Settings;
  readonly communities: readonly MemberCommunity[];
}

const paidNoticeTypes = ["paid_member_joined", "paid_member_canceled"] as const;

export function createWeeklyDigestJob(deps: WeeklyDigestJobDeps) {
  const now = deps.now ?? (() => new Date());
  const appUrl = deps.appUrl.replace(/\/+$/, "");
  const preferencesUrl = `${appUrl}/account/notifications`;

  function asJob<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return deps.db.transaction(async (tx) => {
      await setRlsFlag(tx, "notification_jobs");
      return fn(tx);
    });
  }

  function asUser<T>(userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return deps.db.transaction(async (tx) => {
      await setRlsValue(tx, "user_id", userId);
      return fn(tx);
    });
  }

  async function scan(at: Date, afterId: string | null): Promise<string[]> {
    const zone = sql`coalesce(${notificationSettings.timeZone}, ${defaultTimeZone})`;
    const local = sql`(${at.toISOString()}::timestamptz at time zone ${zone})`;
    return asJob(async (tx) => {
      const rows = await tx
        .select({ userId: users.id })
        .from(users)
        .leftJoin(notificationSettings, eq(notificationSettings.userId, users.id))
        .where(
          and(
            afterId ? gt(users.id, afterId) : undefined,
            eq(users.emailVerified, true),
            isNull(users.deletionScheduledFor),
            isNull(users.erasedAt),
            sql`coalesce(${notificationSettings.weeklyDigest}, ${defaultWeeklyDigest})`,
            sql`extract(isodow from ${local}) = 1`,
            sql`extract(hour from ${local}) = coalesce(${notificationSettings.digestHour}, ${defaultDigestHour})`,
            sql`(${notificationSettings.lastWeeklyDigestAt} is null or ${notificationSettings.lastWeeklyDigestAt} <= ${new Date(at.getTime() - weeklyDigestMinGapMs).toISOString()}::timestamptz)`,
          ),
        )
        .orderBy(asc(users.id))
        .limit(scanPageSize);
      return rows.map((row) => row.userId);
    });
  }

  async function loadSettings(tx: Transaction, userId: string): Promise<Settings | null> {
    const [row] = await tx
      .select({
        digestHour: notificationSettings.digestHour,
        timeZone: notificationSettings.timeZone,
        weeklyDigest: notificationSettings.weeklyDigest,
        lastWeeklyDigestAt: notificationSettings.lastWeeklyDigestAt,
      })
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId));
    if (row && !row.weeklyDigest) {
      return null;
    }
    return {
      digestHour: row?.digestHour ?? defaultDigestHour,
      timeZone: row?.timeZone ?? defaultTimeZone,
      lastWeeklyDigestAt: row?.lastWeeklyDigestAt ?? null,
    };
  }

  async function prepare(userId: string, at: Date): Promise<Prepared | null> {
    return asUser(userId, async (tx) => {
      const settings = await loadSettings(tx, userId);
      const [user] = await tx
        .select({
          email: users.email,
          name: users.name,
          emailVerified: users.emailVerified,
          deletionScheduledFor: users.deletionScheduledFor,
          erasedAt: users.erasedAt,
        })
        .from(users)
        .where(eq(users.id, userId));
      if (
        !settings ||
        !user ||
        !user.emailVerified ||
        user.deletionScheduledFor !== null ||
        user.erasedAt !== null ||
        !isWeeklyDigestDue({ at, ...settings, lastSentAt: settings.lastWeeklyDigestAt })
      ) {
        return null;
      }
      const rows = await tx
        .select({
          id: communities.id,
          slug: communities.slug,
          name: communities.name,
          role: memberships.role,
          joinedAt: memberships.joinedAt,
          appearance: communities.appearance,
        })
        .from(memberships)
        .innerJoin(
          communities,
          and(eq(communities.id, memberships.communityId), isNull(communities.deletedAt)),
        )
        .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
        .orderBy(asc(communities.name));
      return { email: user.email, name: user.name, settings, communities: rows };
    });
  }

  async function recentMembers(communityId: string, since: Date): Promise<RecentMembers> {
    const scope = withCommunity(deps.db, parseCommunityId(communityId));
    return runInCommunity(scope, async (queries) => {
      const joined = queries.where(
        memberships,
        eq(memberships.status, "active"),
        gte(memberships.joinedAt, since),
      );
      const [total] = await queries.tx.select({ value: count() }).from(memberships).where(joined);
      const newest = await queries.tx
        .select({ userId: memberships.userId, name: users.name })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(joined)
        .orderBy(desc(memberships.joinedAt))
        .limit(weeklyDigestMemberNames + 1);
      return { count: total?.value ?? 0, newest };
    });
  }

  async function newMembers(
    cache: RunCache,
    community: MemberCommunity,
    userId: string,
    since: Date,
  ): Promise<DigestMembers> {
    let recent = cache.members.get(community.id);
    if (!recent) {
      recent = await recentMembers(community.id, since);
      cache.members.set(community.id, recent);
    }
    const joinedThisWeek =
      community.joinedAt !== null && community.joinedAt.getTime() >= since.getTime();
    return {
      count: recent.count - (joinedThisWeek ? 1 : 0),
      names: recent.newest
        .filter((member) => member.userId !== userId)
        .slice(0, weeklyDigestMemberNames)
        .map((member) => member.name),
    };
  }

  async function feed(
    cache: RunCache,
    community: MemberCommunity,
    userId: string,
    since: Date,
    at: Date,
  ): Promise<DigestFeed | null> {
    const key = `${community.id}:${community.role}`;
    const cached = cache.feeds.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const read = await deps.source.feed({ userId, communityId: community.id, since, now: at });
    cache.feeds.set(key, read);
    return read;
  }

  async function money(communityId: string, userId: string, since: Date): Promise<DigestMoney> {
    return asUser(userId, async (tx) => {
      const rows = await tx
        .select({ type: notifications.type, value: count() })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.communityId, communityId),
            inArray(notifications.type, [...paidNoticeTypes]),
            gte(notifications.createdAt, since),
          ),
        )
        .groupBy(notifications.type);
      const of = (type: (typeof paidNoticeTypes)[number]) =>
        rows.find((row) => row.type === type)?.value ?? 0;
      return { joined: of("paid_member_joined"), canceled: of("paid_member_canceled") };
    });
  }

  async function compose(
    cache: RunCache,
    userId: string,
    prepared: Prepared,
    at: Date,
  ): Promise<WeeklyDigestCommunity[]> {
    const since = new Date(at.getTime() - weekMs);
    const composed: WeeklyDigestCommunity[] = [];
    for (const community of prepared.communities) {
      const scope = withCommunity(deps.db, parseCommunityId(community.id));
      if (!(await getCommunityAccess(scope, userId, at)).entitled) {
        continue;
      }
      const posts = await feed(cache, community, userId, since, at);
      if (!posts || posts.newPostCount < weeklyDigestMinPosts) {
        continue;
      }
      const extras = await deps.source.extras({
        userId,
        communityId: community.id,
        since,
        now: at,
      });
      composed.push(
        composeCommunity({
          appUrl,
          timeZone: prepared.settings.timeZone,
          community: {
            slug: community.slug,
            name: community.name,
            brand: communityEmailBrand(community.appearance),
          },
          activity: { ...posts, ...extras },
          members: await newMembers(cache, community, userId, since),
          money: community.role === "owner" ? await money(community.id, userId, since) : null,
        }),
      );
    }
    return composed;
  }

  function message(userId: string, prepared: Prepared, digest: WeeklyDigestCommunity[]) {
    const token = createUnsubscribeToken(deps.secret, { userId, scope: "weekly" });
    return {
      to: prepared.email,
      headers: {
        "List-Unsubscribe": `<${appUrl}/api/v1/notification-preferences/unsubscribe?token=${token}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      ...weeklyDigestEmail({
        name: prepared.name,
        communities: digest,
        unsubscribeUrl: `${appUrl}/unsubscribe?token=${token}`,
        preferencesUrl,
      }),
    };
  }

  async function deliver(cache: RunCache, userId: string, at: Date): Promise<"sent" | "skipped"> {
    const prepared = await prepare(userId, at);
    if (!prepared) {
      return "skipped";
    }
    const digest = await compose(cache, userId, prepared, at);
    return asUser(userId, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`weekly-digest:${userId}`}, 0))`,
      );
      const [current] = await tx
        .select({ last: notificationSettings.lastWeeklyDigestAt })
        .from(notificationSettings)
        .where(eq(notificationSettings.userId, userId));
      const last = current?.last ?? null;
      if (last !== null && at.getTime() - last.getTime() < weeklyDigestMinGapMs) {
        return "skipped";
      }
      if (digest.length > 0) {
        await deps.send(message(userId, prepared, digest));
      }
      await tx
        .insert(notificationSettings)
        .values({
          userId,
          digestHour: prepared.settings.digestHour,
          timeZone: prepared.settings.timeZone,
          lastWeeklyDigestAt: at,
        })
        .onConflictDoUpdate({
          target: notificationSettings.userId,
          set: { lastWeeklyDigestAt: at },
        });
      return digest.length > 0 ? "sent" : "skipped";
    });
  }

  return {
    async sendWeeklyDigests(): Promise<WeeklyDigestRunResult> {
      const at = now();
      const cache: RunCache = { feeds: new Map(), members: new Map() };
      let afterId: string | null = null;
      let total = 0;
      let sent = 0;
      let skipped = 0;
      let failed = 0;
      for (;;) {
        const userIds: string[] = await scan(at, afterId);
        for (const userId of userIds) {
          total += 1;
          try {
            const outcome = await deliver(cache, userId, at);
            sent += outcome === "sent" ? 1 : 0;
            skipped += outcome === "skipped" ? 1 : 0;
          } catch (error: unknown) {
            failed += 1;
            deps.onError?.(error, userId);
          }
        }
        const last = userIds.at(-1);
        if (!last || userIds.length < scanPageSize) {
          break;
        }
        afterId = last;
      }
      return { users: total, sent, skipped, failed };
    },
  };
}

export type WeeklyDigestJob = ReturnType<typeof createWeeklyDigestJob>;

let defaultJob: WeeklyDigestJob | undefined;

export function getWeeklyDigestJob(
  appUrl: string,
  source: WeeklyDigestSource,
  onError?: WeeklyDigestJobDeps["onError"],
): WeeklyDigestJob {
  defaultJob ??= createWeeklyDigestJob({
    db: getDb(),
    source,
    send: sendEmail,
    appUrl,
    secret: unsubscribeSecretFromEnv(),
    onError,
  });
  return defaultJob;
}
