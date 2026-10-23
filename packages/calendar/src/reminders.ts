import { communityIdSchema, type CommunityId } from "@cohory/db";

import { reminderMessage } from "./event-emails";
import {
  calendarInvite,
  noticeCommunity,
  nothingSent,
  sendEach,
  type CalendarJobsDeps,
  type ReminderRunResult,
} from "./jobs-context";
import { sendCalendarNotice } from "./notice-jobs";
import type { CalendarNotice } from "./notices";
import { horizonFrom, planOccurrences } from "./occurrences";
import type { CalendarStore, ReminderClaim } from "./repository";
import { ruleOf } from "./service/events";
import { icsEventOf } from "./service/ics-file";
import { timeNotices, type TimeChangeJobPayload } from "./time-change";
import { formatLocalTime } from "./wall-clock";

export { formatLocalTime };
export type { CalendarJobsDeps, ReminderRunResult };

export const remindersJob = "calendar.reminders";
export const extendJob = "calendar.extend";
export const remindersCron = "*/5 * * * *";
export const extendCron = "0 3 * * 1";

export const reminderLeadMinutes = { from: 55, to: 65 } as const;

export interface ReminderWindow {
  readonly from: Date;
  readonly to: Date;
}

export function reminderWindow(now: Date): ReminderWindow {
  return {
    from: new Date(now.getTime() + reminderLeadMinutes.from * 60_000),
    to: new Date(now.getTime() + reminderLeadMinutes.to * 60_000),
  };
}

export function isInReminderWindow(startsAt: Date, now: Date): boolean {
  const { from, to } = reminderWindow(now);
  return startsAt.getTime() >= from.getTime() && startsAt.getTime() < to.getTime();
}

export interface ExtendRunResult {
  readonly communities: number;
  readonly inserted: number;
}

export interface CalendarJobs {
  sendDueReminders(): Promise<ReminderRunResult>;
  extendSeries(): Promise<ExtendRunResult>;
  notifyTimeChange(payload: TimeChangeJobPayload): Promise<ReminderRunResult>;
  sendNotice(notice: CalendarNotice): Promise<ReminderRunResult>;
}

// A member who lost paid access keeps the RSVP, but the reminder carries the meeting link, so the
// claim is handed back instead of sent; it is claimed again if access returns within the window.
async function claimEntitled(
  store: CalendarStore,
  occurrenceIds: readonly string[],
  at: Date,
): Promise<ReminderClaim[]> {
  const claims = await store.claimReminders(occurrenceIds, at);
  const entitled: ReminderClaim[] = [];
  for (const claim of claims) {
    if ((await store.findAccess(claim.userId, at)).entitled) {
      entitled.push(claim);
    } else {
      await store.releaseReminder(claim.occurrenceId, claim.userId, at);
    }
  }
  return entitled;
}

export function createCalendarJobs(deps: CalendarJobsDeps): CalendarJobs {
  const now = deps.now ?? (() => new Date());
  const appUrl = deps.appUrl.replace(/\/+$/, "");

  return {
    async sendDueReminders() {
      const at = now();
      const { from, to } = reminderWindow(at);
      const due = await deps.repo.dueOccurrences(from, to);
      const byCommunity = new Map<CommunityId, string[]>();
      for (const { communityId, occurrenceId } of due) {
        byCommunity.set(communityId, [...(byCommunity.get(communityId) ?? []), occurrenceId]);
      }
      let sent = 0;
      let failed = 0;
      for (const [communityId, occurrenceIds] of byCommunity) {
        const community = await deps.repo.findCommunity(communityId);
        if (!community) {
          continue;
        }
        const claims = await deps.repo.inCommunityAsJob(communityId, (store) =>
          claimEntitled(store, occurrenceIds, at),
        );
        const owner = noticeCommunity(community);
        for (const claim of claims) {
          try {
            const mail = await deps.notifier.eventReminder({
              communityId,
              occurrenceId: claim.occurrenceId,
              userId: claim.userId,
              detail: `Starts in 1 hour: ${claim.title}`,
            });
            if (mail.email) {
              await deps.send(reminderMessage(claim, owner, mail, appUrl));
              sent += 1;
            }
          } catch (error: unknown) {
            failed += 1;
            deps.onSendError?.(error, claim);
            await deps.repo.inCommunityAsJob(communityId, (store) =>
              store.releaseReminder(claim.occurrenceId, claim.userId, at),
            );
          }
        }
      }
      return { sent, failed };
    },

    async notifyTimeChange(payload) {
      const at = now();
      const community = await deps.repo.findCommunity(communityIdSchema.parse(payload.communityId));
      if (!community) {
        return nothingSent;
      }
      const previousStarts = new Map(
        payload.baseline.map((entry) => [entry.occurrenceId, entry.previousStart.getTime()]),
      );
      const found = await deps.repo.inCommunityAsJob(community.id, async (store) => {
        const event = await store.findEventById(payload.eventId);
        if (!event) {
          return null;
        }
        const occurrences = await store.listEventOccurrences(event.id);
        const moved = occurrences
          .filter((o) => {
            const previousStart = previousStarts.get(o.id);
            return previousStart !== undefined && previousStart !== o.startsAt.getTime();
          })
          .map((o) => o.id);
        await store.clearReminders(moved, payload.changedAt);
        const open = new Set(occurrences.filter((o) => o.canceledAt === null).map((o) => o.id));
        const going = (await store.listGoingRecipients(moved)).filter((r) =>
          open.has(r.occurrenceId),
        );
        const entitled = new Set<string>();
        for (const userId of new Set(going.map((r) => r.userId))) {
          if ((await store.findAccess(userId, at)).entitled) {
            entitled.add(userId);
          }
        }
        return {
          event,
          moved: going.filter((r) => entitled.has(r.userId)),
          removed: await store.listMemberRecipients(payload.removals.map((r) => r.userId)),
        };
      });
      if (!found) {
        return nothingSent;
      }
      const owner = noticeCommunity(community);
      const icsEvent = icsEventOf(found.event);
      const notices = timeNotices({
        appUrl,
        community: owner,
        event: found.event,
        payload,
        moved: found.moved,
        removed: found.removed,
        perDate: Boolean(deps.inviteFrom),
      });
      return sendEach(
        deps,
        notices.map(({ message, invite, ...failure }) => {
          const attached = invite
            ? calendarInvite(deps, owner, appUrl, at, {
                method: invite.method,
                event: icsEvent,
                occurrence: { id: invite.occurrenceId, startsAt: invite.startsAt },
                attendee: invite.attendee,
              })
            : undefined;
          return {
            message: attached ? { ...message, calendarInvite: attached } : message,
            failure,
          };
        }),
      );
    },

    sendNotice(notice) {
      return sendCalendarNotice(deps, appUrl, now(), notice);
    },

    async extendSeries() {
      const at = now();
      const communities = await deps.repo.communitiesWithSeries(at);
      let inserted = 0;
      for (const communityId of communities) {
        inserted += await deps.repo.inCommunityAsJob(communityId, async (store) => {
          let count = 0;
          for (const event of await store.listWeeklyEvents()) {
            const planned = planOccurrences(ruleOf(event), {
              notEndingBefore: at,
              horizon: horizonFrom(at),
            });
            count += await store.insertOccurrences(
              planned.map((occurrence) => ({ eventId: event.id, ...occurrence })),
            );
          }
          return count;
        });
      }
      return { communities: communities.length, inserted };
    },
  };
}
