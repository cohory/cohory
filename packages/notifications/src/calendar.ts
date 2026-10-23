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
  memberships,
  notificationDeliveries,
  notificationPreferences,
  notifications,
  notificationSettings,
} from "@cohory/db/schema";
import type { CalendarNotifier, EventMail } from "@cohory/calendar";
import { communityAccessIn } from "@cohory/entitlements/access";
import { and, eq, inArray, ne } from "drizzle-orm";

import { defaultTypePreferences } from "./preferences";
import { createUnsubscribeToken, unsubscribeSecretFromEnv } from "./unsubscribe";

export interface CalendarNotifierDeps {
  readonly db: Database;
  readonly appUrl: string;
  readonly secret: string;
  readonly now?: () => Date;
}

export function createCalendarNotifier(deps: CalendarNotifierDeps): CalendarNotifier {
  const now = deps.now ?? (() => new Date());
  const appUrl = deps.appUrl.replace(/\/+$/, "");

  async function asUser(tx: Transaction, userId: string): Promise<void> {
    await setRlsValue(tx, "user_id", userId);
  }

  async function inAppOff(
    tx: Transaction,
    type: "event_created" | "event_reminder",
    userIds: readonly string[],
  ): Promise<Set<string>> {
    if (userIds.length === 0 || defaultTypePreferences[type].inApp === false) {
      return new Set(userIds);
    }
    const rows = await tx
      .select({ userId: notificationPreferences.userId })
      .from(notificationPreferences)
      .where(
        and(
          inArray(notificationPreferences.userId, [...userIds]),
          eq(notificationPreferences.type, type),
          eq(notificationPreferences.inApp, false),
        ),
      );
    return new Set(rows.map((row) => row.userId));
  }

  async function mailFor(tx: Transaction, userId: string): Promise<EventMail> {
    const [preference] = await tx
      .select({ email: notificationPreferences.email })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.type, "event_reminder"),
        ),
      );
    const [settings] = await tx
      .select({ timeZone: notificationSettings.timeZone })
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId));
    const email = (preference?.email ?? defaultTypePreferences.event_reminder.email) !== "off";
    const token = createUnsubscribeToken(deps.secret, { userId, scope: "event_reminder" });
    return {
      email,
      timeZone: settings?.timeZone ?? null,
      unsubscribeUrl: `${appUrl}/unsubscribe?token=${token}`,
      headers: {
        "List-Unsubscribe": `<${appUrl}/api/v1/notification-preferences/unsubscribe?token=${token}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    };
  }

  return {
    async eventCreated(notice) {
      const communityId = parseCommunityId(notice.communityId);
      return runInCommunity(withCommunity(deps.db, communityId), async (q) => {
        const members = await q.tx
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            q.where(
              memberships,
              eq(memberships.status, "active"),
              ne(memberships.userId, notice.actorId),
            ),
          );
        const at = now();
        await setRlsFlag(q.tx, "notification_jobs");
        const off = await inAppOff(
          q.tx,
          "event_created",
          members.map((m) => m.userId),
        );
        const recipients: string[] = [];
        for (const { userId } of members) {
          if (!off.has(userId) && (await communityAccessIn(q, userId, at)).entitled) {
            recipients.push(userId);
          }
        }
        if (recipients.length === 0) {
          return 0;
        }
        const result = await q.tx
          .insert(notifications)
          .values(
            recipients.map((userId) =>
              q.values({
                userId,
                actorId: notice.actorId,
                type: "event_created" as const,
                subjectType: "event" as const,
                subjectId: notice.eventId,
                postId: null,
                detail: notice.detail,
                createdAt: at,
              }),
            ),
          )
          .onConflictDoNothing();
        return result.rowCount ?? 0;
      });
    },

    async eventReminder(notice) {
      const communityId = parseCommunityId(notice.communityId);
      return runInCommunity(withCommunity(deps.db, communityId), async (q) => {
        await asUser(q.tx, notice.userId);
        const mail = await mailFor(q.tx, notice.userId);
        if ((await inAppOff(q.tx, "event_reminder", [notice.userId])).has(notice.userId)) {
          return mail;
        }
        const [row] = await q.tx
          .insert(notifications)
          .values(
            q.values({
              userId: notice.userId,
              actorId: notice.userId,
              type: "event_reminder" as const,
              subjectType: "event" as const,
              subjectId: notice.occurrenceId,
              postId: null,
              detail: notice.detail,
              createdAt: now(),
            }),
          )
          .onConflictDoNothing()
          .returning({ id: notifications.id });
        if (row) {
          await q.tx
            .insert(notificationDeliveries)
            .values({
              notificationId: row.id,
              userId: notice.userId,
              channel: "email",
              outcome: mail.email ? "sent" : "skipped",
            })
            .onConflictDoNothing();
        }
        return mail;
      });
    },

    eventMail(userId) {
      return deps.db.transaction(async (tx) => {
        await asUser(tx, userId);
        return mailFor(tx, userId);
      });
    },
  };
}

let defaultNotifier: CalendarNotifier | undefined;

export function getCalendarNotifier(appUrl: string): CalendarNotifier {
  defaultNotifier ??= createCalendarNotifier({
    db: getDb(),
    appUrl,
    secret: unsubscribeSecretFromEnv(),
  });
  return defaultNotifier;
}
