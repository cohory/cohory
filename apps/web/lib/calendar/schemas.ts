import type { CreateEventInput } from "@cohory/calendar";
import { z } from "zod";

import { isTimeZone } from "./time-zone";

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(value: string): boolean {
  const match = datePattern.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const slug = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
const eventSlug = z.string().trim().min(1).max(200);
const occurrenceId = z.uuid();

export const eventValuesSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Add a title.")
      .max(120, "Use 120 characters or fewer for the title."),
    description: z.string().trim().max(5000, "Use 5,000 characters or fewer for the description."),
    date: z.string().refine(isCalendarDate, { message: "Pick a date." }),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a start time."),
    timeZone: z.string().refine(isTimeZone, { message: "Pick a time zone from the list." }),
    durationMinutes: z
      .number({ message: "Enter a duration in minutes." })
      .int("Use whole minutes.")
      .min(5, "An event lasts at least 5 minutes.")
      .max(1440, "An event lasts at most 24 hours."),
    recurrence: z.enum(["weekly"]).nullable(),
    recurrenceUntil: z
      .string()
      .refine((value) => value === "" || isCalendarDate(value), { message: "Pick an end date." }),
    location: z.string().trim().max(500, "Use 500 characters or fewer for the location."),
    coverKey: z.string().trim().min(1).max(512).nullable().default(null),
  })
  .superRefine((values, context) => {
    if (values.recurrenceUntil === "") return;
    if (values.recurrence === null) {
      context.addIssue({
        code: "custom",
        path: ["recurrenceUntil"],
        message: "Only a weekly event can have an end date.",
      });
      return;
    }
    if (values.recurrenceUntil <= values.date) {
      context.addIssue({
        code: "custom",
        path: ["recurrenceUntil"],
        message: "The end date must be after the first date.",
      });
    }
  });

export const createEventSchema = z.object({
  slug,
  values: eventValuesSchema,
  notifyMembers: z.boolean().default(false),
});
export const updateEventSchema = z.object({
  slug,
  eventSlug,
  occurrenceId,
  values: eventValuesSchema,
});
export const eventRefSchema = z.object({ slug, eventSlug });
export const deletePreviewSchema = z.object({ slug, eventSlug });
export const previewEventChangeSchema = z.object({ slug, eventSlug, values: eventValuesSchema });
export const setCanceledSchema = z.object({ slug, occurrenceId, canceled: z.boolean() });
export const rsvpSchema = z.object({ slug, occurrenceId, status: z.enum(["going", "not_going"]) });
export const recordingSchema = z.object({
  slug,
  eventSlug,
  recordingUrl: z
    .string()
    .trim()
    .max(2000, "Use a shorter link.")
    .refine((value) => value === "" || /^https?:\/\/\S+$/i.test(value), {
      message: "Use a link that starts with https:// or http://.",
    }),
});

export type EventValues = z.output<typeof eventValuesSchema>;
export type CreateEventActionInput = z.input<typeof createEventSchema>;
export type UpdateEventActionInput = z.input<typeof updateEventSchema>;
export type EventRefInput = z.input<typeof eventRefSchema>;
export type PreviewEventChangeInput = z.input<typeof previewEventChangeSchema>;
export type SetCanceledInput = z.input<typeof setCanceledSchema>;
export type RsvpActionInput = z.input<typeof rsvpSchema>;
export type RecordingActionInput = z.input<typeof recordingSchema>;

export function toServiceInput(values: EventValues): CreateEventInput {
  return {
    title: values.title,
    description: values.description || null,
    startsAtLocal: `${values.date}T${values.time}`,
    timeZone: values.timeZone,
    durationMinutes: values.durationMinutes,
    recurrence: values.recurrence,
    recurrenceUntil: values.recurrence === null ? null : values.recurrenceUntil || null,
    location: values.location || null,
    coverKey: values.coverKey,
  };
}
