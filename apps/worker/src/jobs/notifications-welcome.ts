import { getCalendarService, type CalendarService } from "@cohory/calendar";
import { type CoursesService } from "@cohory/courses";
import { notificationsWelcomeJob, welcomeJobPayloadSchema } from "@cohory/events";
import {
  getWelcomeEmailJob,
  type SendWelcomeEmail,
  type WelcomeExtras,
  type WelcomeSource,
} from "@cohory/notifications";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const NOTIFICATIONS_WELCOME = notificationsWelcomeJob;

interface CourseItem {
  readonly slug: string;
  readonly title: string;
  readonly status: string;
  readonly publishedLessonCount: number;
}

interface Occurrence {
  readonly id: string;
  readonly startsAt: Date;
  readonly event: { readonly slug: string; readonly title: string };
}

export interface WelcomeServices {
  readonly courses: {
    listCourses(...args: Parameters<CoursesService["listCourses"]>): Promise<readonly CourseItem[]>;
  };
  readonly calendar: {
    getNextForViewer(
      ...args: Parameters<CalendarService["getNextForViewer"]>
    ): Promise<readonly Occurrence[]>;
  };
}

export function createWelcomeSource(services: WelcomeServices): WelcomeSource {
  return async ({ userId, communityId }): Promise<WelcomeExtras> => {
    const actor = { kind: "user" as const, userId, platformAdmin: false };
    const [courses, next] = await Promise.all([
      services.courses.listCourses(actor, communityId),
      services.calendar.getNextForViewer(actor, communityId),
    ]);
    const course = courses.find(
      (item) => item.status === "published" && item.publishedLessonCount > 0,
    );
    const [event] = next;
    return {
      firstCourse: course ? { slug: course.slug, title: course.title } : null,
      nextEvent: event
        ? {
            eventSlug: event.event.slug,
            occurrenceId: event.id,
            title: event.event.title,
            startsAt: event.startsAt,
          }
        : null,
    };
  };
}

export function defaultWelcomeEmailJob(
  appUrl: string,
  courses: WelcomeServices["courses"],
): SendWelcomeEmail {
  return getWelcomeEmailJob(
    appUrl,
    createWelcomeSource({ courses, calendar: getCalendarService() }),
  );
}

export function createNotificationsWelcomeHandler(logger: Logger, sendWelcome: SendWelcomeEmail) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const input = welcomeJobPayloadSchema.parse(job.data);
      const outcome = await sendWelcome(input);
      logger.info({ jobId: job.id, job: job.name, outcome }, "welcome email");
    }
  };
}

export const notificationsWelcomeJobDefinition: JobDefinition = {
  name: NOTIFICATIONS_WELCOME,
  queueOptions: { retryLimit: 5, retryBackoff: true },
  payloadSchema: welcomeJobPayloadSchema,
  handler: ({ logger, deps }) => createNotificationsWelcomeHandler(logger, deps.sendWelcomeEmail),
};
