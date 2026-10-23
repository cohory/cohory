import {
  eventCanceledEmail,
  eventReminderEmail,
  rsvpConfirmationEmail,
  type EmailMessage,
  type EventCanceledReason,
} from "@cohory/email";

import type { EventMail } from "./notices";
import type { NoticeCommunity } from "./time-change";
import { formatLocalTime } from "./wall-clock";

export interface EventEmailTarget {
  readonly occurrenceId: string;
  readonly eventSlug: string;
  readonly title: string;
  readonly timeZone: string;
  readonly startsAt: Date;
  readonly location: string | null;
  readonly email: string;
  readonly name: string;
}

function common(
  target: EventEmailTarget,
  community: NoticeCommunity,
  mail: EventMail,
  appUrl: string,
) {
  const eventPath = [community.slug, "calendar", target.eventSlug, target.occurrenceId]
    .map(encodeURIComponent)
    .join("/");
  const zone = mail.timeZone ?? target.timeZone;
  return {
    name: target.name,
    communityName: community.name,
    communityBrand: community.brand,
    title: target.title,
    when: formatLocalTime(target.startsAt, zone),
    eventWhen: zone === target.timeZone ? null : formatLocalTime(target.startsAt, target.timeZone),
    location: target.location,
    eventUrl: `${appUrl}/c/${eventPath}`,
    footer: mail.unsubscribeUrl
      ? { unsubscribeUrl: mail.unsubscribeUrl, preferencesUrl: `${appUrl}/account/notifications` }
      : null,
  };
}

export function reminderMessage(
  target: EventEmailTarget,
  community: NoticeCommunity,
  mail: EventMail,
  appUrl: string,
): EmailMessage {
  return {
    to: target.email,
    headers: { ...mail.headers },
    ...eventReminderEmail(common(target, community, mail, appUrl)),
  };
}

export function rsvpConfirmationMessage(
  target: EventEmailTarget,
  community: NoticeCommunity,
  mail: EventMail,
  appUrl: string,
  invite: EmailMessage["calendarInvite"],
): EmailMessage {
  const ics = `${appUrl}/api/v1/communities/${encodeURIComponent(community.slug)}/calendar/occurrences/${encodeURIComponent(target.occurrenceId)}/ics`;
  return {
    to: target.email,
    headers: { ...mail.headers },
    ...(invite ? { calendarInvite: invite } : {}),
    ...rsvpConfirmationEmail({ ...common(target, community, mail, appUrl), icsUrl: ics }),
  };
}

export interface CanceledTarget {
  readonly title: string;
  readonly timeZone: string;
  readonly startsAt: Date;
  readonly email: string;
  readonly name: string;
}

export function canceledMessage(
  target: CanceledTarget,
  community: NoticeCommunity,
  calendarUrl: string,
  reason: EventCanceledReason,
  invite: EmailMessage["calendarInvite"],
): EmailMessage {
  return {
    to: target.email,
    ...(invite ? { calendarInvite: invite } : {}),
    ...eventCanceledEmail({
      name: target.name,
      communityName: community.name,
      communityBrand: community.brand,
      title: target.title,
      when: formatLocalTime(target.startsAt, target.timeZone),
      reason,
      calendarUrl,
    }),
  };
}
