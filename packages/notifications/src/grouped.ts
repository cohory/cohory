import type { ScopedQueries } from "@cohory/db";
import { notificationDeliveries, notificationGroupSources, notifications } from "@cohory/db/schema";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { setRlsValue } from "@cohory/db";

import { groupCount } from "./render";

export const reportGroupWindowMs = 60 * 60 * 1000;

export type GroupedNotice =
  | {
      readonly kind: "actors";
      readonly type: "like_on_post" | "like_on_comment" | "member_joined";
      readonly subjectType: "post" | "comment" | "community";
      readonly subjectId: string;
      readonly postId: string | null;
      readonly userId: string;
      readonly actorId: string;
    }
  | {
      readonly kind: "report";
      readonly type: "report_created";
      readonly subjectType: "report";
      readonly subjectId: string;
      readonly postId: null;
      readonly userId: string;
      readonly actorId: string;
    };

interface OpenGroup {
  readonly id: string;
  readonly detail: string | null;
}

async function findOpenGroup(
  { tx, where }: ScopedQueries,
  notice: GroupedNotice,
  at: Date,
): Promise<OpenGroup | null> {
  const [row] = await tx
    .select({
      id: notifications.id,
      detail: notifications.detail,
    })
    .from(notifications)
    .where(
      where(
        notifications,
        eq(notifications.userId, notice.userId),
        eq(notifications.type, notice.type),
        isNull(notifications.readAt),
        sql`not exists (select 1 from ${notificationDeliveries} where ${notificationDeliveries.notificationId} = ${notifications.id})`,
        notice.kind === "actors"
          ? eq(notifications.subjectId, notice.subjectId)
          : gte(notifications.createdAt, new Date(at.getTime() - reportGroupWindowMs)),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(1);
  return row ?? null;
}

function nextDetail(open: OpenGroup, notice: GroupedNotice): string {
  const count = groupCount(open.detail);
  return String(notice.kind === "actors" ? count + 1 : Math.max(count, 1) + 1);
}

function sourceKey(notice: GroupedNotice): string {
  return notice.kind === "report" ? notice.subjectId : notice.actorId;
}

async function countSource(
  { tx, values }: ScopedQueries,
  notificationId: string,
  notice: GroupedNotice,
): Promise<boolean> {
  const result = await tx
    .insert(notificationGroupSources)
    .values(values({ notificationId, sourceKey: sourceKey(notice) }))
    .onConflictDoNothing();
  return result.rowCount === 1;
}

async function alreadyUnread({ tx, where }: ScopedQueries, notice: GroupedNotice) {
  const [row] = await tx
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      where(
        notifications,
        eq(notifications.userId, notice.userId),
        eq(notifications.type, notice.type),
        eq(notifications.subjectId, notice.subjectId),
        eq(notifications.actorId, notice.actorId),
        isNull(notifications.readAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function upsertGroupedNotice(
  queries: ScopedQueries,
  notice: GroupedNotice,
  options: { readonly at: Date; readonly newId: () => string },
): Promise<boolean> {
  const { tx, values } = queries;
  await setRlsValue(tx, "user_id", notice.userId);
  if (await alreadyUnread(queries, notice)) {
    return false;
  }
  const open = await findOpenGroup(queries, notice, options.at);
  if (open) {
    if (!(await countSource(queries, open.id, notice))) {
      return false;
    }
    await tx
      .update(notifications)
      .set({
        actorId: notice.actorId,
        subjectId: notice.subjectId,
        detail: nextDetail(open, notice),
        createdAt: options.at,
      })
      .where(and(eq(notifications.id, open.id), eq(notifications.userId, notice.userId)));
    return true;
  }
  const id = options.newId();
  const result = await tx
    .insert(notifications)
    .values(
      values({
        id,
        userId: notice.userId,
        actorId: notice.actorId,
        type: notice.type,
        subjectType: notice.subjectType,
        subjectId: notice.subjectId,
        postId: notice.postId,
        detail: notice.kind === "report" ? "1" : null,
        createdAt: options.at,
      }),
    )
    .onConflictDoNothing();
  if ((result.rowCount ?? 0) === 0) {
    return false;
  }
  await countSource(queries, id, notice);
  return true;
}
