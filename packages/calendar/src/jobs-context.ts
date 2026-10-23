import { communityEmailBrand, type EmailMessage } from "@cohory/email";

import { icsSequence, type IcsEvent, type IcsMethod, type IcsPerson } from "./ics";
import type { CalendarNotifier } from "./notices";
import type { CalendarRepository, CommunityRecord } from "./repository";
import { singleDateIcs, type IcsOccurrence } from "./service/ics-file";
import type { NoticeCommunity, SendFailure } from "./time-change";

export interface CalendarJobsDeps {
  readonly repo: CalendarRepository;
  readonly send: (message: EmailMessage) => Promise<void>;
  readonly notifier: CalendarNotifier;
  readonly appUrl: string;
  readonly inviteFrom?: string | null;
  readonly now?: () => Date;
  readonly onSendError?: (error: unknown, failure: SendFailure) => void;
}

export interface ReminderRunResult {
  readonly sent: number;
  readonly failed: number;
}

export const nothingSent: ReminderRunResult = { sent: 0, failed: 0 };

export function noticeCommunity(community: CommunityRecord): NoticeCommunity {
  return {
    slug: community.slug,
    name: community.name,
    brand: communityEmailBrand(community.appearance),
  };
}

export function calendarPageUrl(appUrl: string, community: NoticeCommunity): string {
  return `${appUrl}/c/${encodeURIComponent(community.slug)}/calendar`;
}

export interface InviteRequest {
  readonly method: IcsMethod;
  readonly event: IcsEvent;
  readonly occurrence: IcsOccurrence;
  readonly attendee: IcsPerson;
}

// Each invite is stamped with the moment its job read the state it describes, so a later read
// always wins in the member's calendar (RFC 5546 SEQUENCE).
export function calendarInvite(
  deps: CalendarJobsDeps,
  community: NoticeCommunity,
  appUrl: string,
  at: Date,
  request: InviteRequest,
): EmailMessage["calendarInvite"] {
  if (!deps.inviteFrom) {
    return undefined;
  }
  const content = singleDateIcs(
    request.event,
    request.occurrence,
    calendarPageUrl(appUrl, community),
    at,
    {
      organizer: { name: community.name, email: deps.inviteFrom },
      attendee: request.attendee,
      method: request.method,
      sequence: icsSequence(at),
    },
  );
  return { method: request.method, content };
}

export async function sendEach(
  deps: CalendarJobsDeps,
  messages: readonly { readonly message: EmailMessage; readonly failure: SendFailure }[],
): Promise<ReminderRunResult> {
  let sent = 0;
  let failed = 0;
  for (const { message, failure } of messages) {
    try {
      await deps.send(message);
      sent += 1;
    } catch (error: unknown) {
      failed += 1;
      deps.onSendError?.(error, failure);
    }
  }
  return { sent, failed };
}
