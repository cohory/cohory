import { ForbiddenError } from "@cohory/authz";
import { getCalendarService, type CalendarService } from "@cohory/calendar";
import { type CoursesService } from "@cohory/courses";
import {
  getWeeklyDigestJob,
  notificationsWeeklyDigestCron,
  notificationsWeeklyDigestJob,
  type DigestExtras,
  type DigestFeed,
  type WeeklyDigestRunResult,
  type WeeklyDigestSource,
  type WeeklyDigestSourceInput,
} from "@cohory/notifications";
import { type PostsService } from "@cohory/posts";

import { createNotificationEmailHandler } from "./notifications-email";
import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const NOTIFICATIONS_WEEKLY_DIGEST = notificationsWeeklyDigestJob;
export const weeklyDigestCron = notificationsWeeklyDigestCron;

export type SendWeeklyDigests = () => Promise<WeeklyDigestRunResult>;

const recentPostsScanned = 100;
const topPostsShown = 3;
const topPostsScanned = 20;
const eventsShown = 2;
const eventWindowMs = 7 * 24 * 60 * 60 * 1000;
const minPostsForDigest = 2;

interface FeedPost {
  readonly id: string;
  readonly title: string | null;
  readonly excerpt: string;
  readonly commentCount: number;
  readonly createdAt: Date;
}

interface Occurrence {
  readonly id: string;
  readonly startsAt: Date;
  readonly canceledAt: Date | null;
  readonly event: { readonly slug: string; readonly title: string };
}

export interface WeeklyDigestServices {
  readonly posts: {
    listFeed(
      ...args: Parameters<PostsService["listFeed"]>
    ): Promise<{ readonly data: readonly FeedPost[] }>;
  };
  readonly calendar: {
    listOccurrences(
      ...args: Parameters<CalendarService["listOccurrences"]>
    ): Promise<readonly Occurrence[]>;
  };
  readonly courses: Pick<CoursesService, "getContinueLearning">;
}

function memberActor(userId: string) {
  return { kind: "user" as const, userId, platformAdmin: false };
}

export function createWeeklyDigestSource(services: WeeklyDigestServices): WeeklyDigestSource {
  async function readFeed({ userId, communityId, since }: WeeklyDigestSourceInput) {
    const actor = memberActor(userId);
    const recent = await services.posts.listFeed(actor, communityId, {
      sort: "new",
      limit: recentPostsScanned,
    });
    const thisWeek = (post: FeedPost) => post.createdAt.getTime() >= since.getTime();
    const newPostCount = recent.data.filter(thisWeek).length;
    if (newPostCount < minPostsForDigest) {
      return { newPostCount, topPosts: [] };
    }
    const top = await services.posts.listFeed(actor, communityId, {
      sort: "top",
      limit: topPostsScanned,
    });
    return {
      newPostCount,
      topPosts: top.data
        .filter(thisWeek)
        .slice(0, topPostsShown)
        .map((post) => ({
          id: post.id,
          title: post.title,
          excerpt: post.excerpt,
          commentCount: post.commentCount,
        })),
    };
  }

  return {
    async feed(input): Promise<DigestFeed | null> {
      try {
        return await readFeed(input);
      } catch (error: unknown) {
        if (error instanceof ForbiddenError) {
          return null;
        }
        throw error;
      }
    },
    async extras({ userId, communityId, now }): Promise<DigestExtras> {
      const actor = memberActor(userId);
      const [occurrences, learning] = await Promise.all([
        services.calendar.listOccurrences(actor, communityId, {
          from: now,
          to: new Date(now.getTime() + eventWindowMs),
        }),
        services.courses.getContinueLearning(actor, communityId),
      ]);
      return {
        events: occurrences
          .filter((occurrence) => occurrence.canceledAt === null)
          .slice(0, eventsShown)
          .map((occurrence) => ({
            id: occurrence.id,
            eventSlug: occurrence.event.slug,
            title: occurrence.event.title,
            startsAt: occurrence.startsAt,
          })),
        progress: learning
          ? {
              courseSlug: learning.course.slug,
              courseTitle: learning.course.title,
              lessonSlug: learning.lesson.slug,
              lessonTitle: learning.lesson.title,
              percent: learning.progressPercent,
            }
          : null,
      };
    },
  };
}

export function defaultWeeklyDigestJob(
  appUrl: string,
  logger: Logger,
  services: Pick<WeeklyDigestServices, "posts" | "courses">,
) {
  const source = createWeeklyDigestSource({ ...services, calendar: getCalendarService() });
  return getWeeklyDigestJob(appUrl, source, (error, userId) => {
    logger.warn(
      {
        err: error instanceof Error ? { name: error.name, message: error.message } : undefined,
        userId,
      },
      "weekly digest not sent",
    );
  });
}

export const weeklyDigestJobDefinition: JobDefinition = {
  name: NOTIFICATIONS_WEEKLY_DIGEST,
  queueOptions: { policy: "stately" },
  cron: weeklyDigestCron,
  handler: ({ logger, deps }) =>
    createNotificationEmailHandler(logger, deps.sendWeeklyDigests, "weekly digests sent"),
};
