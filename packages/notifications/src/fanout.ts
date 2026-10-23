import {
  getDb,
  newId,
  parseCommunityId,
  runInCommunity,
  setRlsFlag,
  setRlsValue,
  withCommunity,
  type Database,
  type ScopedQueries,
} from "@cohory/db";
import { memberships, notifications, postFollows } from "@cohory/db/schema";
import { communityAccessIn } from "@cohory/entitlements/access";
import type { PostEvent } from "@cohory/posts";
import { and, eq, inArray, isNotNull, or, type SQL } from "drizzle-orm";

import { upsertGroupedNotice, type GroupedNotice } from "./grouped";
import { planNotifications } from "./plan";
import { previewNotificationTypes, type NotificationDraft } from "./types";

export interface FanoutDeps {
  readonly db: Database;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface FanoutResult {
  readonly inserted: number;
}

export type NotificationsFanout = (events: readonly PostEvent[]) => Promise<FanoutResult>;

const staffRoles = ["owner", "admin", "moderator"] as const;

function groupByCommunity(events: readonly PostEvent[]): Map<string, PostEvent[]> {
  const groups = new Map<string, PostEvent[]>();
  for (const event of events) {
    const id = event.payload.communityId;
    groups.set(id, [...(groups.get(id) ?? []), event]);
  }
  return groups;
}

function likeNotice(event: PostEvent): GroupedNotice[] {
  if (event.type !== "like.added") {
    return [];
  }
  const p = event.payload;
  const postId = p.subjectType === "post" ? p.subjectId : p.postId;
  if (p.userId === p.subjectAuthorId || !postId) {
    return [];
  }
  return [
    {
      kind: "actors",
      type: p.subjectType === "post" ? "like_on_post" : "like_on_comment",
      subjectType: p.subjectType,
      subjectId: p.subjectId,
      postId,
      userId: p.subjectAuthorId,
      actorId: p.userId,
    },
  ];
}

async function activeMembers(
  { tx, where }: ScopedQueries,
  userIds: readonly string[],
): Promise<Set<string>> {
  if (userIds.length === 0) {
    return new Set();
  }
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      where(
        memberships,
        inArray(memberships.userId, [...new Set(userIds)]),
        eq(memberships.status, "active"),
      ),
    );
  return new Set(rows.map((row) => row.userId));
}

async function reportNotices(
  { tx, where }: ScopedQueries,
  events: readonly PostEvent[],
): Promise<GroupedNotice[]> {
  const reports = events.flatMap((event) => (event.type === "report.created" ? [event] : []));
  if (reports.length === 0) {
    return [];
  }
  const staff = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      where(
        memberships,
        eq(memberships.status, "active"),
        inArray(memberships.role, [...staffRoles]),
      ),
    );
  return reports.flatMap(({ payload }) =>
    staff
      .filter((member) => member.userId !== payload.reporterId)
      .map((member) => ({
        kind: "report" as const,
        type: "report_created" as const,
        subjectType: "report" as const,
        subjectId: payload.reportId,
        postId: null,
        userId: member.userId,
        actorId: payload.reporterId,
      })),
  );
}

function removedContent(event: PostEvent): SQL[] {
  switch (event.type) {
    case "comment.deleted":
      return [eq(notifications.subjectId, event.payload.commentId)];
    case "post.deleted":
      return [eq(notifications.postId, event.payload.postId)];
    case "report.resolved": {
      const p = event.payload;
      if (p.resolution !== "content_removed") {
        return [];
      }
      return [
        p.commentId ? eq(notifications.subjectId, p.commentId) : eq(notifications.postId, p.postId),
      ];
    }
    default:
      return [];
  }
}

async function clearRemovedPreviews(
  { tx, where }: ScopedQueries,
  events: readonly PostEvent[],
): Promise<number> {
  const removed = events.flatMap(removedContent);
  if (removed.length === 0) {
    return 0;
  }
  const target = where(
    notifications,
    inArray(notifications.type, [...previewNotificationTypes]),
    isNotNull(notifications.detail),
    or(...removed),
  );
  await setRlsFlag(tx, "notification_jobs");
  const owners = await tx
    .selectDistinct({ userId: notifications.userId })
    .from(notifications)
    .where(target);
  await setRlsFlag(tx, "notification_jobs", false);
  let cleared = 0;
  for (const { userId } of owners) {
    await setRlsValue(tx, "user_id", userId);
    const result = await tx
      .update(notifications)
      .set({ detail: null })
      .where(and(target, eq(notifications.userId, userId)));
    cleared += result.rowCount ?? 0;
  }
  await setRlsValue(tx, "user_id", "");
  return cleared;
}

async function followerDrafts(
  { tx, where }: ScopedQueries,
  events: readonly PostEvent[],
  planned: readonly NotificationDraft[],
): Promise<NotificationDraft[]> {
  const created = events.flatMap((event) =>
    event.type === "comment.created" ? [event.payload] : [],
  );
  if (created.length === 0) {
    return [];
  }
  await setRlsFlag(tx, "notification_jobs");
  const follows = await tx
    .select({ postId: postFollows.postId, userId: postFollows.userId })
    .from(postFollows)
    .where(
      where(postFollows, inArray(postFollows.postId, [...new Set(created.map((c) => c.postId))])),
    );
  await setRlsFlag(tx, "notification_jobs", false);
  const notified = new Set(planned.map((draft) => `${draft.userId}:${draft.subjectId}`));
  return created.flatMap((comment) =>
    follows
      .filter(
        (follow) =>
          follow.postId === comment.postId &&
          follow.userId !== comment.authorId &&
          !notified.has(`${follow.userId}:${comment.commentId}`),
      )
      .map((follow) => ({
        communityId: comment.communityId,
        userId: follow.userId,
        actorId: comment.authorId,
        type: "comment_on_followed_post" as const,
        subjectType: "comment" as const,
        subjectId: comment.commentId,
        postId: comment.postId,
        preview: comment.preview ?? null,
      })),
  );
}

function needsEntitlement(draft: NotificationDraft): boolean {
  return draft.preview !== null || draft.type === "comment_on_followed_post";
}

async function entitledRecipients(
  queries: ScopedQueries,
  drafts: readonly NotificationDraft[],
  at: Date,
): Promise<Set<string>> {
  const readers = new Set<string>();
  const recipients = new Set(drafts.filter(needsEntitlement).map((d) => d.userId));
  for (const userId of recipients) {
    if ((await communityAccessIn(queries, userId, at)).entitled) {
      readers.add(userId);
    }
  }
  return readers;
}

export function createNotificationsFanout(deps: FanoutDeps): NotificationsFanout {
  const now = deps.now ?? (() => new Date());
  const makeId = deps.newId ?? newId;

  async function insertDrafts(
    queries: ScopedQueries,
    drafts: readonly NotificationDraft[],
    createdAt: Date,
  ): Promise<number> {
    if (drafts.length === 0) {
      return 0;
    }
    const active = await activeMembers(
      queries,
      drafts.map((draft) => draft.userId),
    );
    const members = drafts.filter((draft) => active.has(draft.userId));
    const entitled = await entitledRecipients(queries, members, createdAt);
    const deliverable = members.filter(
      (draft) => draft.type !== "comment_on_followed_post" || entitled.has(draft.userId),
    );
    if (deliverable.length === 0) {
      return 0;
    }
    const result = await queries.tx
      .insert(notifications)
      .values(
        deliverable.map((draft) =>
          queries.values({
            id: makeId(),
            userId: draft.userId,
            actorId: draft.actorId,
            type: draft.type,
            subjectType: draft.subjectType,
            subjectId: draft.subjectId,
            postId: draft.postId,
            detail: entitled.has(draft.userId) ? draft.preview : null,
            createdAt,
          }),
        ),
      )
      .onConflictDoNothing();
    return result.rowCount ?? 0;
  }

  async function upsertGrouped(
    queries: ScopedQueries,
    events: readonly PostEvent[],
    at: Date,
  ): Promise<number> {
    const likes = events.flatMap(likeNotice);
    const active = await activeMembers(
      queries,
      likes.map((like) => like.userId),
    );
    const notices = [
      ...likes.filter((like) => active.has(like.userId)),
      ...(await reportNotices(queries, events)),
    ];
    let changed = 0;
    for (const notice of notices) {
      if (await upsertGroupedNotice(queries, notice, { at, newId: makeId })) {
        changed += 1;
      }
    }
    return changed;
  }

  return async (events) => {
    let inserted = 0;
    for (const [communityId, group] of groupByCommunity(events)) {
      const scope = withCommunity(deps.db, parseCommunityId(communityId));
      inserted += await runInCommunity(scope, async (queries) => {
        const createdAt = now();
        const drafts = planNotifications(group);
        const followers = await followerDrafts(queries, group, drafts);
        const planned = await insertDrafts(queries, [...drafts, ...followers], createdAt);
        const grouped = await upsertGrouped(queries, group, createdAt);
        await clearRemovedPreviews(queries, group);
        return planned + grouped;
      });
    }
    return { inserted };
  };
}

let defaultFanout: NotificationsFanout | undefined;

export function getNotificationsFanout(): NotificationsFanout {
  defaultFanout ??= createNotificationsFanout({ db: getDb() });
  return defaultFanout;
}
