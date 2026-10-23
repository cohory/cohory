import {
  calendarNoticeSchema,
  createCalendarJobs,
  createPostgresCalendarRepository,
  extendJob,
  noticeJob,
  remindersJob,
  timeChangeJob,
  timeChangeJobPayloadSchema,
  type CalendarJobs,
} from "@cohory/calendar";
import { getDb } from "@cohory/db";
import { parseEmailEnv, sendEmail } from "@cohory/email";
import { getCalendarNotifier } from "@cohory/notifications";
import type { Job } from "pg-boss";

import {
  extendCron,
  noticeQueueOptions,
  remindersCron,
  timeChangeQueueOptions,
} from "@cohory/calendar";
import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const CALENDAR_REMINDERS = remindersJob;
export const CALENDAR_EXTEND = extendJob;
export const CALENDAR_TIME_CHANGE = timeChangeJob;
export const CALENDAR_NOTICE = noticeJob;

export type SendDueReminders = CalendarJobs["sendDueReminders"];
export type ExtendSeries = CalendarJobs["extendSeries"];
export type NotifyTimeChange = CalendarJobs["notifyTimeChange"];
export type SendCalendarNotice = CalendarJobs["sendNotice"];

function inviteFrom(): string | null {
  const env = parseEmailEnv();
  return env.driver === "smtp" ? env.fromAddress : null;
}

let jobs: CalendarJobs | undefined;

export function defaultCalendarJobs(appUrl: string, logger: Logger): CalendarJobs {
  jobs ??= createCalendarJobs({
    repo: createPostgresCalendarRepository(getDb()),
    send: sendEmail,
    notifier: getCalendarNotifier(appUrl),
    inviteFrom: inviteFrom(),
    appUrl,
    onSendError: (error, failure) => {
      logger.warn(
        {
          err: error instanceof Error ? { name: error.name, message: error.message } : undefined,
          occurrenceId: failure.occurrenceId,
          userId: failure.userId,
        },
        "event email not sent",
      );
    },
  });
  return jobs;
}

export function createCalendarRemindersHandler(logger: Logger, run: SendDueReminders) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      logger.info({ jobId: job.id, job: job.name, ...result }, "event reminders sent");
    }
  };
}

export function createCalendarExtendHandler(logger: Logger, run: ExtendSeries) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      logger.info({ jobId: job.id, job: job.name, ...result }, "event series extended");
    }
  };
}

export function createCalendarTimeChangeHandler(logger: Logger, run: NotifyTimeChange) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const payload = timeChangeJobPayloadSchema.parse(job.data);
      const result = await run(payload);
      logger.info(
        { jobId: job.id, job: job.name, eventId: payload.eventId, ...result },
        "event time change emails sent",
      );
    }
  };
}

export function createCalendarNoticeHandler(logger: Logger, run: SendCalendarNotice) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const notice = calendarNoticeSchema.parse(job.data);
      const result = await run(notice);
      logger.info(
        { jobId: job.id, job: job.name, kind: notice.kind, ...result },
        "calendar notice sent",
      );
    }
  };
}

export const calendarRemindersJobDefinition: JobDefinition = {
  name: CALENDAR_REMINDERS,
  queueOptions: { policy: "stately" },
  cron: remindersCron,
  handler: ({ logger, deps }) => createCalendarRemindersHandler(logger, deps.sendDueReminders),
};

export const calendarExtendJobDefinition: JobDefinition = {
  name: CALENDAR_EXTEND,
  queueOptions: { policy: "stately" },
  cron: extendCron,
  handler: ({ logger, deps }) => createCalendarExtendHandler(logger, deps.extendSeries),
};

export const calendarTimeChangeJobDefinition: JobDefinition = {
  name: CALENDAR_TIME_CHANGE,
  queueOptions: timeChangeQueueOptions,
  payloadSchema: timeChangeJobPayloadSchema,
  handler: ({ logger, deps }) => createCalendarTimeChangeHandler(logger, deps.notifyTimeChange),
};

export const calendarNoticeJobDefinition: JobDefinition = {
  name: CALENDAR_NOTICE,
  queueOptions: noticeQueueOptions,
  payloadSchema: calendarNoticeSchema,
  handler: ({ logger, deps }) => createCalendarNoticeHandler(logger, deps.sendCalendarNotice),
};
