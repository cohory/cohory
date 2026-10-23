import { z } from "zod";

import { compareDates, isValidTimeZone, parseCalendarDate, parseWallClock } from "./wall-clock";

export const maxTitleLength = 120;
export const maxDescriptionLength = 5000;
export const maxLocationLength = 500;
export const maxRecordingUrlLength = 2000;
export const minDurationMinutes = 5;
export const maxDurationMinutes = 1440;
export const maxRangeDays = 100;
export const maxSeriesYears = 2;

const title = z.string().trim().min(1, "Add a title.").max(maxTitleLength);
const description = z.string().trim().max(maxDescriptionLength).nullable();
const startsAtLocal = z.string().refine((value) => parseWallClock(value) !== null, {
  message: "Use a local date and time like 2026-10-18T18:00.",
});
const timeZone = z
  .string()
  .refine(isValidTimeZone, { message: "Use an IANA time zone like Europe/Berlin." });
const durationMinutes = z.number().int().min(minDurationMinutes).max(maxDurationMinutes);
const recurrence = z.enum(["weekly"]).nullable();
const recurrenceUntil = z
  .string()
  .refine((value) => parseCalendarDate(value) !== null, { message: "Use a date like 2026-12-31." })
  .nullable();
const location = z.string().trim().max(maxLocationLength).nullable();

const coverKey = z.string().trim().min(1).max(512).nullable();

export const recordingUrlSchema = z
  .url({ protocol: /^https?$/, message: "Use a link that starts with https:// or http://." })
  .max(maxRecordingUrlLength)
  .nullable();

export const createEventInputSchema = z.strictObject({
  title,
  description: description.optional(),
  startsAtLocal,
  timeZone,
  durationMinutes,
  recurrence: recurrence.optional(),
  recurrenceUntil: recurrenceUntil.optional(),
  location: location.optional(),
  coverKey: coverKey.optional(),
  notifyMembers: z.boolean().optional(),
});

export const updateEventInputSchema = z
  .strictObject({
    title: title.optional(),
    description: description.optional(),
    startsAtLocal: startsAtLocal.optional(),
    timeZone: timeZone.optional(),
    durationMinutes: durationMinutes.optional(),
    recurrence: recurrence.optional(),
    recurrenceUntil: recurrenceUntil.optional(),
    location: location.optional(),
    coverKey: coverKey.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Change at least one field." });

export const recordingInputSchema = z.strictObject({ recordingUrl: recordingUrlSchema });

export const rsvpInputSchema = z.strictObject({ status: z.enum(["going", "not_going"]) });

export const rangeInputSchema = z
  .strictObject({ from: z.date(), to: z.date() })
  .refine((range) => range.to.getTime() > range.from.getTime(), {
    message: "The end must be after the start.",
    path: ["to"],
  })
  .refine((range) => range.to.getTime() - range.from.getTime() <= maxRangeDays * 86_400_000, {
    message: `Ask for at most ${maxRangeDays} days at a time.`,
    path: ["to"],
  });

export type CreateEventInput = z.input<typeof createEventInputSchema>;
export type UpdateEventInput = z.input<typeof updateEventInputSchema>;
export type RecordingInput = z.input<typeof recordingInputSchema>;
export type RsvpInput = z.input<typeof rsvpInputSchema>;
export type RangeInput = z.input<typeof rangeInputSchema>;

export interface RuleFields {
  readonly startsAtLocal: string;
  readonly recurrence: "weekly" | null;
  readonly recurrenceUntil: string | null;
}

export function ruleIssues(rule: RuleFields): { path: string; message: string }[] {
  if (rule.recurrenceUntil === null) {
    return [];
  }
  if (rule.recurrence === null) {
    return [{ path: "recurrenceUntil", message: "Only a weekly event can have an end date." }];
  }
  const start = parseWallClock(rule.startsAtLocal);
  const until = parseCalendarDate(rule.recurrenceUntil);
  if (!start || !until) {
    return [];
  }
  if (compareDates(start, until) >= 0) {
    return [{ path: "recurrenceUntil", message: "The end date must be after the first date." }];
  }
  if (compareDates({ ...start, year: start.year + maxSeriesYears }, until) < 0) {
    return [
      { path: "recurrenceUntil", message: `A series can run for at most ${maxSeriesYears} years.` },
    ];
  }
  return [];
}
