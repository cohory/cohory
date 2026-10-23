import {
  eventDatesRemovedEmail,
  eventUpdatedEmail,
  type CommunityBrandInput,
  type EmailMessage,
} from "@cohory/email";
import { z } from "zod";

import type { CalendarNoticeInput } from "./notices";
import { maxPlannedOccurrences } from "./occurrences";
import type { EventRecord, GoingRecipient, MemberRecipient } from "./repository";
import { formatLocalTime, isValidTimeZone } from "./wall-clock";

export const timeChangeJob = "calendar.time-change";

export const timeChangeDelaySeconds = 60;

// One move job per event waits in the queue at a time ("short" policy keyed by event), so a burst
// of edits within the delay sends one email that compares the final dates with the baseline taken
// before the first edit. Removal jobs carry their own key because deleted dates cannot be re-read.
export const timeChangeQueueOptions = {
  policy: "short",
  retryLimit: 5,
  retryBackoff: true,
} as const;

const instant = z.union([z.date(), z.iso.datetime().transform((value) => new Date(value))]);

export const timeChangeJobPayloadSchema = z
  .object({
    communityId: z.uuid(),
    eventId: z.uuid(),
    editorId: z.uuid().nullable(),
    changedAt: instant,
    previousZone: z.string().refine(isValidTimeZone),
    baseline: z
      .array(z.object({ occurrenceId: z.uuid(), previousStart: instant }))
      .max(maxPlannedOccurrences),
    removals: z.array(
      z.object({
        userId: z.uuid(),
        starts: z.array(instant).min(1).max(maxPlannedOccurrences),
        occurrenceIds: z.array(z.uuid()).max(maxPlannedOccurrences).optional(),
      }),
    ),
  })
  .refine((payload) => payload.baseline.length + payload.removals.length > 0);

export type TimeChangeJobInput = z.input<typeof timeChangeJobPayloadSchema>;
export type TimeChangeJobPayload = z.output<typeof timeChangeJobPayloadSchema>;

export interface CalendarQueue {
  scheduleTimeChange(payload: TimeChangeJobInput): Promise<void>;
  scheduleNotice(payload: CalendarNoticeInput): Promise<void>;
}

export interface SendFailure {
  readonly occurrenceId: string | null;
  readonly userId: string;
}

export interface TimeNoticeInvite {
  readonly method: "REQUEST" | "CANCEL";
  readonly occurrenceId: string;
  readonly startsAt: Date;
  readonly attendee: { readonly name: string; readonly email: string };
}

export interface TimeNotice extends SendFailure {
  readonly message: EmailMessage;
  readonly invite: TimeNoticeInvite | null;
}

export interface NoticeCommunity {
  readonly slug: string;
  readonly name: string;
  readonly brand: CommunityBrandInput;
}

export interface TimeNoticeInput {
  readonly appUrl: string;
  readonly community: NoticeCommunity;
  readonly event: EventRecord;
  readonly payload: TimeChangeJobPayload;
  readonly moved: readonly GoingRecipient[];
  readonly removed: readonly MemberRecipient[];
  readonly perDate: boolean;
}

export function timeNotices(input: TimeNoticeInput): TimeNotice[] {
  return [...moveNotices(input), ...removalNotices(input)];
}

function moveNotices(input: TimeNoticeInput) {
  const { appUrl, community: owner, event, payload, moved, perDate } = input;
  const community = encodeURIComponent(owner.slug);
  const eventSegment = encodeURIComponent(event.slug);
  const api = `${appUrl}/api/v1/communities/${community}/calendar`;
  const series = event.recurrence === "weekly";
  const previousStarts = new Map(payload.baseline.map((m) => [m.occurrenceId, m.previousStart]));
  const notified = new Set<string>();
  const notices: TimeNotice[] = [];
  for (const { occurrenceId, userId, email, name, startsAt } of moved) {
    const previousStart = previousStarts.get(occurrenceId);
    if (
      !previousStart ||
      previousStart.getTime() === startsAt.getTime() ||
      userId === payload.editorId ||
      notified.has(perDate ? `${userId}:${occurrenceId}` : userId)
    ) {
      continue;
    }
    notified.add(perDate ? `${userId}:${occurrenceId}` : userId);
    notices.push({
      occurrenceId,
      userId,
      invite: perDate
        ? { method: "REQUEST", occurrenceId, startsAt, attendee: { name, email } }
        : null,
      message: {
        to: email,
        ...eventUpdatedEmail({
          name,
          communityName: owner.name,
          communityBrand: owner.brand,
          eventTitle: event.title,
          oldStart: formatLocalTime(previousStart, payload.previousZone),
          newStart: formatLocalTime(startsAt, event.timeZone),
          series,
          eventUrl: `${appUrl}/c/${community}/calendar/${eventSegment}/${occurrenceId}`,
          icsUrl: series
            ? `${api}/events/${eventSegment}/ics`
            : `${api}/occurrences/${occurrenceId}/ics`,
        }),
      },
    });
  }
  return notices;
}

interface RemovedDates {
  readonly starts: readonly Date[];
  readonly occurrenceId: string | null;
}

function removedGroups(
  starts: readonly Date[],
  occurrenceIds: readonly string[] | undefined,
  perDate: boolean,
): RemovedDates[] {
  if (!perDate || !occurrenceIds || occurrenceIds.length !== starts.length) {
    return [{ starts, occurrenceId: null }];
  }
  return starts.map((start, index) => ({
    starts: [start],
    occurrenceId: occurrenceIds[index] ?? null,
  }));
}

function removalNotices(input: TimeNoticeInput) {
  const { appUrl, community, event, payload, removed, perDate } = input;
  const recipients = new Map(removed.map((recipient) => [recipient.userId, recipient]));
  const calendarUrl = `${appUrl}/c/${encodeURIComponent(community.slug)}/calendar`;
  return payload.removals.flatMap(({ userId, starts, occurrenceIds }): TimeNotice[] => {
    const recipient = recipients.get(userId);
    if (!recipient || userId === payload.editorId) {
      return [];
    }
    return removedGroups(starts, occurrenceIds, perDate).map((group) => ({
      occurrenceId: group.occurrenceId,
      userId,
      invite:
        group.occurrenceId && group.starts[0]
          ? {
              method: "CANCEL" as const,
              occurrenceId: group.occurrenceId,
              startsAt: group.starts[0],
              attendee: { name: recipient.name, email: recipient.email },
            }
          : null,
      message: {
        to: recipient.email,
        ...eventDatesRemovedEmail({
          name: recipient.name,
          communityName: community.name,
          communityBrand: community.brand,
          eventTitle: event.title,
          dates: group.starts.map((start) => formatLocalTime(start, payload.previousZone)),
          calendarUrl,
        }),
      },
    }));
  });
}
