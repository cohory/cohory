import { z } from "zod";

export const noticeJob = "calendar.notice";

export const maxDeletedAttendees = 20_000;

const instant = z.union([z.date(), z.iso.datetime().transform((value) => new Date(value))]);

export const noticeQueueOptions = {
  policy: "short",
  retryLimit: 5,
  retryBackoff: true,
} as const;

export const calendarNoticeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("event_created"),
    communityId: z.uuid(),
    eventId: z.uuid(),
    actorId: z.uuid(),
  }),
  z.strictObject({
    kind: z.literal("rsvp_going"),
    communityId: z.uuid(),
    occurrenceId: z.uuid(),
    userId: z.uuid(),
  }),
  z.strictObject({
    kind: z.literal("rsvp_not_going"),
    communityId: z.uuid(),
    occurrenceId: z.uuid(),
    userId: z.uuid(),
  }),
  z.strictObject({
    kind: z.literal("date_status"),
    communityId: z.uuid(),
    occurrenceId: z.uuid(),
  }),
  z.strictObject({
    kind: z.literal("event_deleted"),
    communityId: z.uuid(),
    eventId: z.uuid(),
    title: z.string().min(1).max(500),
    timeZone: z.string().min(1).max(100),
    durationMinutes: z.number().int().positive(),
    attendees: z
      .array(z.strictObject({ occurrenceId: z.uuid(), userId: z.uuid(), startsAt: instant }))
      .max(maxDeletedAttendees),
  }),
]);

export type CalendarNoticeInput = z.input<typeof calendarNoticeSchema>;
export type CalendarNotice = z.output<typeof calendarNoticeSchema>;

// Jobs read the current state when they run, so a notice queued while an equal one still waits
// adds nothing and the "short" policy drops it.
export function noticeKey(notice: CalendarNoticeInput): string {
  switch (notice.kind) {
    case "event_created":
      return `created:${notice.eventId}`;
    case "event_deleted":
      return `deleted:${notice.eventId}`;
    case "date_status":
      return `date:${notice.occurrenceId}`;
    case "rsvp_going":
      return `going:${notice.occurrenceId}:${notice.userId}`;
    case "rsvp_not_going":
      return `not-going:${notice.occurrenceId}:${notice.userId}`;
  }
}

export interface EventMail {
  readonly email: boolean;
  readonly timeZone: string | null;
  readonly unsubscribeUrl: string | null;
  readonly headers: Readonly<Record<string, string>>;
}

export interface EventCreatedNotice {
  readonly communityId: string;
  readonly eventId: string;
  readonly actorId: string;
  readonly detail: string;
}

export interface EventReminderNotice {
  readonly communityId: string;
  readonly occurrenceId: string;
  readonly userId: string;
  readonly detail: string;
}

export interface CalendarNotifier {
  eventCreated(notice: EventCreatedNotice): Promise<number>;
  eventReminder(notice: EventReminderNotice): Promise<EventMail>;
  eventMail(userId: string): Promise<EventMail>;
}
