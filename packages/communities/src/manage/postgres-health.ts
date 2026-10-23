import type { ScopedQueries } from "@cohory/db";
import {
  comments,
  communityGalleryItems,
  courses,
  eventOccurrences,
  lessonProgress,
  memberships,
  posts,
  reactions,
  sessions,
} from "@cohory/db/schema";
import {
  and,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { setRlsFlag } from "@cohory/db";

import type { CommunityHealth, HealthTrend, HealthWindow } from "./health";
import type { SetupCounts } from "./setup-checklist";

const staffRoles = sql`('owner', 'admin', 'moderator')`;

function at(date: Date): SQL {
  return sql`${date.toISOString()}::timestamptz`;
}

function counted(condition: SQL): SQL<number> {
  return sql<number>`count(*) filter (where ${condition})`.mapWith(Number);
}

function trend(current: number | undefined, previous: number | undefined): HealthTrend {
  return { current: current ?? 0, previous: previous ?? 0 };
}

export async function setupCountsQuery(
  { tx, where }: ScopedQueries,
  now: Date,
): Promise<SetupCounts> {
  const one = async (rows: Promise<{ value: number }[]>) => (await rows)[0]?.value ?? 0;
  const galleryItems = await one(
    tx.select({ value: count() }).from(communityGalleryItems).where(where(communityGalleryItems)),
  );
  const pinnedStaffPosts = await one(
    tx
      .select({ value: count() })
      .from(posts)
      .innerJoin(
        memberships,
        and(eq(memberships.communityId, posts.communityId), eq(memberships.userId, posts.authorId)),
      )
      .where(
        where(
          posts,
          isNotNull(posts.pinnedAt),
          isNull(posts.deletedAt),
          eq(memberships.status, "active"),
          sql`${memberships.role} in ${staffRoles}`,
        ),
      ),
  );
  const publishedCourses = await one(
    tx
      .select({ value: count() })
      .from(courses)
      .where(where(courses, eq(courses.status, "published"))),
  );
  const upcomingEvents = await one(
    tx
      .select({ value: count() })
      .from(eventOccurrences)
      .where(
        where(
          eventOccurrences,
          gte(eventOccurrences.startsAt, now),
          isNull(eventOccurrences.canceledAt),
        ),
      ),
  );
  const members = await one(
    tx
      .select({ value: count() })
      .from(memberships)
      .where(where(memberships, eq(memberships.status, "active"), eq(memberships.role, "member"))),
  );
  return { galleryItems, pinnedStaffPosts, publishedCourses, upcomingEvents, members };
}

export async function communityHealthQuery(
  queries: ScopedQueries,
  window: HealthWindow,
): Promise<CommunityHealth> {
  const { tx, where, communityId } = queries;
  await setRlsFlag(tx, "course_manager");
  const notStaff = (userId: AnyColumn) =>
    sql`not exists (select 1 from ${memberships} staff where staff.community_id = ${communityId} and staff.user_id = ${userId} and staff.status = 'active' and staff.role in ${staffRoles})`;
  const byStaff = (userId: SQL) =>
    sql`exists (select 1 from ${memberships} staff where staff.community_id = ${communityId} and staff.user_id = ${userId} and staff.status = 'active' and staff.role in ${staffRoles})`;
  const joined = sql`coalesce(${memberships.joinedAt}, ${memberships.createdAt})`;
  const seen = sql`coalesce(${memberships.lastSeenAt}, ${joined})`;
  const activeSince = (cutoff: Date) =>
    sql`(${seen} >= ${at(cutoff)} or exists (select 1 from ${sessions} where ${sessions.userId} = ${memberships.userId} and ${sessions.updatedAt} >= ${at(cutoff)}))`;
  const greeted = sql`(exists (select 1 from ${reactions} r where r.community_id = ${communityId} and r.subject_author_id = ${memberships.userId} and ${byStaff(sql`r.user_id`)}) or exists (select 1 from ${comments} c join ${posts} p on p.id = c.post_id where c.community_id = ${communityId} and p.author_id = ${memberships.userId} and c.deleted_at is null and ${byStaff(sql`c.author_id`)}))`;
  const thisWeek = (column: SQL) =>
    sql`${column} >= ${at(window.weekStart)} and ${column} < ${at(window.now)}`;
  const lastWeek = (column: SQL) =>
    sql`${column} >= ${at(window.lastWeekStart)} and ${column} < ${at(window.weekStart)}`;

  const [memberRow] = await tx
    .select({
      members: counted(sql`true`),
      membersWeekAgo: counted(sql`${joined} < ${at(window.weekStart)}`),
      newThisWeek: counted(thisWeek(joined)),
      newLastWeek: counted(lastWeek(joined)),
      active7d: counted(activeSince(window.weekStart)),
      active30d: counted(activeSince(window.monthStart)),
      newNotGreeted: counted(sql`${thisWeek(joined)} and not ${greeted}`),
    })
    .from(memberships)
    .where(where(memberships, eq(memberships.status, "active"), eq(memberships.role, "member")));

  const [postRow] = await tx
    .select({
      current: counted(thisWeek(sql`${posts.createdAt}`)),
      previous: counted(lastWeek(sql`${posts.createdAt}`)),
    })
    .from(posts)
    .where(
      where(
        posts,
        isNull(posts.deletedAt),
        isNull(posts.scheduledAt),
        gte(posts.createdAt, window.lastWeekStart),
        notStaff(posts.authorId),
      ),
    );

  const [commentRow] = await tx
    .select({
      current: counted(thisWeek(sql`${comments.createdAt}`)),
      previous: counted(lastWeek(sql`${comments.createdAt}`)),
    })
    .from(comments)
    .where(
      where(
        comments,
        isNull(comments.deletedAt),
        gte(comments.createdAt, window.lastWeekStart),
        notStaff(comments.authorId),
      ),
    );

  const [lessonRow] = await tx
    .select({
      current: counted(thisWeek(sql`${lessonProgress.completedAt}`)),
      previous: counted(lastWeek(sql`${lessonProgress.completedAt}`)),
    })
    .from(lessonProgress)
    .where(
      where(
        lessonProgress,
        gte(lessonProgress.completedAt, window.lastWeekStart),
        notStaff(lessonProgress.userId),
      ),
    );

  const [top] = await tx
    .select({
      id: posts.id,
      title: posts.title,
      excerpt: posts.excerpt,
      likeCount: posts.likeCount,
      commentCount: posts.commentCount,
    })
    .from(posts)
    .where(
      where(
        posts,
        isNull(posts.deletedAt),
        isNull(posts.scheduledAt),
        gte(posts.createdAt, window.weekStart),
        sql`${posts.likeCount} + ${posts.commentCount} > 0`,
      ),
    )
    .orderBy(desc(sql`${posts.likeCount} + ${posts.commentCount}`), desc(posts.createdAt))
    .limit(1);

  return {
    members: trend(memberRow?.members, memberRow?.membersWeekAgo),
    newMembers: trend(memberRow?.newThisWeek, memberRow?.newLastWeek),
    activeMembers7d: memberRow?.active7d ?? 0,
    activeMembers30d: memberRow?.active30d ?? 0,
    posts: trend(postRow?.current, postRow?.previous),
    comments: trend(commentRow?.current, commentRow?.previous),
    lessonsCompleted: trend(lessonRow?.current, lessonRow?.previous),
    newNotGreeted: memberRow?.newNotGreeted ?? 0,
    topPost: top ?? null,
  };
}
