import { communityIdSchema } from "@cohory/db";
import type { EmailMessage } from "@cohory/email";

import { canceledMessage, rsvpConfirmationMessage } from "./event-emails";
import type { IcsEvent } from "./ics";
import {
  calendarInvite,
  calendarPageUrl,
  noticeCommunity,
  nothingSent,
  sendEach,
  type CalendarJobsDeps,
  type ReminderRunResult,
} from "./jobs-context";
import type { CalendarNotice } from "./notices";
import type { CalendarStore, MemberRecipient, OccurrenceRow } from "./repository";
import { icsEventOf } from "./service/ics-file";
import type { NoticeCommunity, SendFailure } from "./time-change";

type Notice<K extends CalendarNotice["kind"]> = Extract<CalendarNotice, { kind: K }>;

interface Outgoing {
  readonly message: EmailMessage;
  readonly failure: SendFailure;
}

interface NoticeContext {
  readonly deps: CalendarJobsDeps;
  readonly appUrl: string;
  readonly at: Date;
  readonly communityId: ReturnType<typeof communityIdSchema.parse>;
  readonly community: NoticeCommunity;
}

function attendee(recipient: MemberRecipient) {
  return { name: recipient.name, email: recipient.email };
}

async function entitledRecipients(
  store: CalendarStore,
  userIds: readonly string[],
  at: Date,
): Promise<MemberRecipient[]> {
  const recipients = await store.listMemberRecipients(userIds);
  const entitled: MemberRecipient[] = [];
  for (const recipient of recipients) {
    if ((await store.findAccess(recipient.userId, at)).entitled) {
      entitled.push(recipient);
    }
  }
  return entitled;
}

async function confirmation(
  context: NoticeContext,
  row: OccurrenceRow,
  recipient: MemberRecipient,
): Promise<Outgoing | null> {
  const mail = await context.deps.notifier.eventMail(recipient.userId);
  if (!mail.email) {
    return null;
  }
  const invite = calendarInvite(context.deps, context.community, context.appUrl, context.at, {
    method: "REQUEST",
    event: icsEventOf(row.event),
    occurrence: row.occurrence,
    attendee: attendee(recipient),
  });
  const target = {
    occurrenceId: row.occurrence.id,
    eventSlug: row.event.slug,
    title: row.event.title,
    timeZone: row.event.timeZone,
    startsAt: row.occurrence.startsAt,
    location: row.event.location,
    email: recipient.email,
    name: recipient.name,
  };
  return {
    message: rsvpConfirmationMessage(target, context.community, mail, context.appUrl, invite),
    failure: { occurrenceId: row.occurrence.id, userId: recipient.userId },
  };
}

function cancellation(
  context: NoticeContext,
  event: IcsEvent,
  occurrence: { readonly id: string; readonly startsAt: Date },
  recipient: MemberRecipient,
  reason: "canceled" | "deleted" | "not_going",
): Outgoing {
  const invite = calendarInvite(context.deps, context.community, context.appUrl, context.at, {
    method: "CANCEL",
    event,
    occurrence,
    attendee: attendee(recipient),
  });
  const target = {
    title: event.title,
    timeZone: event.timeZone,
    startsAt: occurrence.startsAt,
    email: recipient.email,
    name: recipient.name,
  };
  return {
    message: canceledMessage(
      target,
      context.community,
      calendarPageUrl(context.appUrl, context.community),
      reason,
      invite,
    ),
    failure: { occurrenceId: occurrence.id, userId: recipient.userId },
  };
}

function upcoming(row: OccurrenceRow, at: Date): boolean {
  return row.occurrence.endsAt.getTime() > at.getTime();
}

async function rsvpGoing(context: NoticeContext, notice: Notice<"rsvp_going">) {
  const found = await context.deps.repo.inCommunityAsJob(context.communityId, async (store) => {
    const row = await store.findOccurrence(notice.occurrenceId, notice.userId);
    const [recipient] = await entitledRecipients(store, [notice.userId], context.at);
    return row && recipient ? { row, recipient } : null;
  });
  if (
    !found ||
    found.row.viewerRsvp !== "going" ||
    found.row.occurrence.canceledAt !== null ||
    !upcoming(found.row, context.at)
  ) {
    return [];
  }
  const outgoing = await confirmation(context, found.row, found.recipient);
  return outgoing ? [outgoing] : [];
}

async function rsvpNotGoing(context: NoticeContext, notice: Notice<"rsvp_not_going">) {
  if (!context.deps.inviteFrom) {
    return [];
  }
  const found = await context.deps.repo.inCommunityAsJob(context.communityId, async (store) => {
    const row = await store.findOccurrence(notice.occurrenceId, notice.userId);
    const [recipient] = await store.listMemberRecipients([notice.userId]);
    return row && recipient ? { row, recipient } : null;
  });
  if (
    !found ||
    found.row.viewerRsvp !== "not_going" ||
    found.row.occurrence.canceledAt !== null ||
    !upcoming(found.row, context.at)
  ) {
    return [];
  }
  const mail = await context.deps.notifier.eventMail(notice.userId);
  if (!mail.email) {
    return [];
  }
  const { row, recipient } = found;
  return [cancellation(context, icsEventOf(row.event), row.occurrence, recipient, "not_going")];
}

async function dateStatus(context: NoticeContext, notice: Notice<"date_status">) {
  const found = await context.deps.repo.inCommunityAsJob(context.communityId, async (store) => {
    const row = await store.findOccurrence(notice.occurrenceId, null);
    if (!row) {
      return null;
    }
    const going = (await store.listGoingRecipients([row.occurrence.id])).map((r) => r.userId);
    const recipients =
      row.occurrence.canceledAt === null
        ? await entitledRecipients(store, going, context.at)
        : await store.listMemberRecipients(going);
    return { row, recipients };
  });
  if (!found || !upcoming(found.row, context.at)) {
    return [];
  }
  const { row, recipients } = found;
  if (row.occurrence.canceledAt !== null) {
    const event = icsEventOf(row.event);
    return recipients.map((r) => cancellation(context, event, row.occurrence, r, "canceled"));
  }
  const restored = await Promise.all(recipients.map((r) => confirmation(context, row, r)));
  return restored.filter((outgoing) => outgoing !== null);
}

async function eventDeleted(context: NoticeContext, notice: Notice<"event_deleted">) {
  const attendees = notice.attendees.filter((a) => a.startsAt.getTime() > context.at.getTime());
  const recipients = await context.deps.repo.inCommunityAsJob(context.communityId, (store) =>
    store.listMemberRecipients([...new Set(attendees.map((a) => a.userId))]),
  );
  const byUser = new Map(recipients.map((recipient) => [recipient.userId, recipient]));
  const event: IcsEvent = {
    eventId: notice.eventId,
    title: notice.title,
    description: null,
    location: null,
    startsAtLocal: "2000-01-01T00:00",
    timeZone: notice.timeZone,
    durationMinutes: notice.durationMinutes,
    recurrence: null,
    recurrenceUntil: null,
    canceledStarts: [],
  };
  return attendees.flatMap((entry) => {
    const recipient = byUser.get(entry.userId);
    return recipient
      ? [
          cancellation(
            context,
            event,
            { id: entry.occurrenceId, startsAt: entry.startsAt },
            recipient,
            "deleted",
          ),
        ]
      : [];
  });
}

export async function sendCalendarNotice(
  deps: CalendarJobsDeps,
  appUrl: string,
  at: Date,
  notice: CalendarNotice,
): Promise<ReminderRunResult> {
  const record = await deps.repo.findCommunity(communityIdSchema.parse(notice.communityId));
  if (!record) {
    return nothingSent;
  }
  const context: NoticeContext = {
    deps,
    appUrl,
    at,
    communityId: record.id,
    community: noticeCommunity(record),
  };
  switch (notice.kind) {
    case "event_created": {
      const event = await deps.repo.inCommunityAsJob(record.id, (store) =>
        store.findEventById(notice.eventId),
      );
      const sent = event
        ? await deps.notifier.eventCreated({
            communityId: record.id,
            eventId: event.id,
            actorId: notice.actorId,
            detail: `New event: ${event.title}`,
          })
        : 0;
      return { sent, failed: 0 };
    }
    case "rsvp_going":
      return sendEach(deps, await rsvpGoing(context, notice));
    case "rsvp_not_going":
      return sendEach(deps, await rsvpNotGoing(context, notice));
    case "date_status":
      return sendEach(deps, await dateStatus(context, notice));
    case "event_deleted":
      return sendEach(deps, await eventDeleted(context, notice));
  }
}
