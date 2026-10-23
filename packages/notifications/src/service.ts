import { assertCan, UnauthenticatedError, type ActionOf, type Actor } from "@cohory/authz";
import { getDb, setRlsValue, type Database, type Transaction } from "@cohory/db";
import {
  communities,
  memberships,
  notificationPreferences,
  notifications,
  users,
} from "@cohory/db/schema";
import { and, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { decodeCursor, encodeCursor, type NotificationCursor } from "./cursor";
import { notificationPath } from "./links";
import { NotificationValidationError } from "./errors";
import { renderNotificationText } from "./render";
import {
  hasPreview,
  inAppNotificationTypes,
  type InAppNotificationType,
  type NotificationPage,
  type NotificationView,
} from "./types";

export const notificationsPageSize = 20;
export const maxNotificationsPageSize = 100;
export const maxMarkReadIds = 100;

export const listNotificationsInputSchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(maxNotificationsPageSize).optional(),
});

export const markReadInputSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(maxMarkReadIds),
});

export type ListNotificationsInput = z.input<typeof listNotificationsInputSchema>;
export type MarkReadInput = z.input<typeof markReadInputSchema>;

export interface UnreadCount {
  readonly unreadCount: number;
}

export interface NotificationsServiceDeps {
  readonly db: Database;
  readonly now?: () => Date;
}

function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new NotificationValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

function requireUserId(actor: Actor, action: ActionOf<"notification">): string {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  assertCan(actor, action, "notification");
  return actor.userId;
}

function isDelivered(type: string): type is InAppNotificationType {
  return (inAppNotificationTypes as readonly string[]).includes(type);
}

const delivered = inArray(notifications.type, [...inAppNotificationTypes]);

const shownInApp = sql`not exists (select 1 from ${notificationPreferences} where ${notificationPreferences.userId} = ${notifications.userId} and ${notificationPreferences.type} = ${notifications.type} and ${notificationPreferences.inApp} = false)`;

function visibleTo(userId: string, ...conditions: (SQL | undefined)[]): SQL {
  return and(eq(notifications.userId, userId), delivered, shownInApp, ...conditions) ?? sql`false`;
}

function olderThan(cursor: NotificationCursor): SQL {
  return sql`(${notifications.createdAt}, ${notifications.id}) < (${cursor.createdAt}, ${cursor.id})`;
}

export function createNotificationsService(deps: NotificationsServiceDeps) {
  const now = deps.now ?? (() => new Date());

  function asUser<T>(
    actor: Actor,
    fn: (tx: Transaction, userId: string) => Promise<T>,
    action: ActionOf<"notification"> = "read",
  ) {
    const userId = requireUserId(actor, action);
    return deps.db.transaction(async (tx) => {
      await setRlsValue(tx, "user_id", userId);
      return fn(tx, userId);
    });
  }

  async function countUnread(tx: Transaction, userId: string): Promise<number> {
    const [row] = await tx
      .select({ value: count() })
      .from(notifications)
      .innerJoin(
        communities,
        and(eq(communities.id, notifications.communityId), isNull(communities.deletedAt)),
      )
      .innerJoin(
        memberships,
        and(
          eq(memberships.communityId, notifications.communityId),
          eq(memberships.userId, notifications.userId),
          eq(memberships.status, "active"),
        ),
      )
      .where(visibleTo(userId, isNull(notifications.readAt)));
    return row?.value ?? 0;
  }

  return {
    async listNotifications(
      actor: Actor,
      input: ListNotificationsInput = {},
    ): Promise<NotificationPage> {
      const { cursor, limit = notificationsPageSize } = parseOrThrow(
        listNotificationsInputSchema,
        input,
      );
      const after = cursor ? decodeCursor(cursor) : null;
      return asUser(actor, async (tx, userId) => {
        const rows = await tx
          .select({
            notification: notifications,
            actorName: users.name,
            actorImage: users.image,
            communitySlug: communities.slug,
            communityName: communities.name,
          })
          .from(notifications)
          .innerJoin(users, eq(users.id, notifications.actorId))
          .innerJoin(
            communities,
            and(eq(communities.id, notifications.communityId), isNull(communities.deletedAt)),
          )
          .innerJoin(
            memberships,
            and(
              eq(memberships.communityId, notifications.communityId),
              eq(memberships.userId, notifications.userId),
              eq(memberships.status, "active"),
            ),
          )
          .where(visibleTo(userId, after ? olderThan(after) : undefined))
          .orderBy(desc(notifications.createdAt), desc(notifications.id))
          .limit(limit + 1);
        const page = rows.slice(0, limit);
        const data: NotificationView[] = [];
        for (const row of page) {
          const n = row.notification;
          if (!isDelivered(n.type)) {
            continue;
          }
          data.push({
            id: n.id,
            type: n.type,
            community: { id: n.communityId, slug: row.communitySlug, name: row.communityName },
            actor: { id: n.actorId, name: row.actorName, image: row.actorImage },
            subjectType: n.subjectType,
            subjectId: n.subjectId,
            postId: n.postId,
            href: notificationPath({
              type: n.type,
              subjectType: n.subjectType,
              communitySlug: row.communitySlug,
              postId: n.postId,
            }),
            text: renderNotificationText({
              type: n.type,
              subjectType: n.subjectType,
              actorName: row.actorName,
              detail: n.detail,
            }),
            preview: hasPreview(n.type) ? n.detail : null,
            readAt: n.readAt,
            createdAt: n.createdAt,
          });
        }
        const last = page.at(-1)?.notification;
        return {
          data,
          nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
        };
      });
    },

    async unreadCount(actor: Actor): Promise<number> {
      return asUser(actor, countUnread);
    },

    async unreadCountsByCommunity(actor: Actor): Promise<ReadonlyMap<string, number>> {
      return asUser(actor, async (tx, userId) => {
        const rows = await tx
          .select({ communityId: notifications.communityId, value: count() })
          .from(notifications)
          .innerJoin(
            memberships,
            and(
              eq(memberships.communityId, notifications.communityId),
              eq(memberships.userId, notifications.userId),
              eq(memberships.status, "active"),
            ),
          )
          .where(visibleTo(userId, isNull(notifications.readAt)))
          .groupBy(notifications.communityId);
        return new Map(rows.map((row) => [row.communityId, row.value]));
      });
    },

    async markRead(actor: Actor, input: MarkReadInput): Promise<UnreadCount> {
      const { ids } = parseOrThrow(markReadInputSchema, input);
      return asUser(
        actor,
        async (tx, userId) => {
          await tx
            .update(notifications)
            .set({ readAt: now() })
            .where(
              and(
                eq(notifications.userId, userId),
                inArray(notifications.id, ids),
                isNull(notifications.readAt),
              ),
            );
          return { unreadCount: await countUnread(tx, userId) };
        },
        "mark_read",
      );
    },

    async markAllRead(actor: Actor): Promise<UnreadCount> {
      return asUser(
        actor,
        async (tx, userId) => {
          await tx
            .update(notifications)
            .set({ readAt: now() })
            .where(visibleTo(userId, isNull(notifications.readAt)));
          return { unreadCount: await countUnread(tx, userId) };
        },
        "mark_read",
      );
    },
  };
}

export type NotificationsService = ReturnType<typeof createNotificationsService>;

let defaultService: NotificationsService | undefined;

export function getNotificationsService(): NotificationsService {
  defaultService ??= createNotificationsService({ db: getDb() });
  return defaultService;
}
