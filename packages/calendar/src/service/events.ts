import { assertCan, ForbiddenError, type Actor } from "@cohory/authz";

import { CalendarNotFoundError } from "../errors";
import type { SeriesRule } from "../occurrences";
import { planForRule } from "../reconcile";
import type { EventRecord } from "../repository";
import { maxDeletedAttendees } from "../notices";
import type { TimeChangeJobInput } from "../time-change";
import {
  createEventInputSchema,
  recordingInputSchema,
  updateEventInputSchema,
  type CreateEventInput,
  type RecordingInput,
  type UpdateEventInput,
} from "../schemas";
import { nextFreeSlug, slugify } from "../slug";
import type {
  EventChangePreview,
  EventDeletePreview,
  EventDetail,
  EventWithOccurrences,
} from "../views";
import { parse, withAccess, withWriteAccess, type Access, type Runtime } from "./context";
import { checkCoverKey } from "./cover";
import { scheduleNotice } from "./notify";
import { presentOccurrences, toEventDetail } from "./present";
import { checkRule, countPeople, planScheduleChange, removalsOf } from "./schedule-change";

export { ruleOf } from "./schedule-change";

export interface EventOperations {
  createEvent(actor: Actor, communityId: string, input: CreateEventInput): Promise<EventDetail>;
  updateEvent(
    actor: Actor,
    communityId: string,
    eventSlug: string,
    input: UpdateEventInput,
  ): Promise<EventDetail>;
  deleteEvent(actor: Actor, communityId: string, eventSlug: string): Promise<void>;
  setRecordingUrl(
    actor: Actor,
    communityId: string,
    eventSlug: string,
    input: RecordingInput,
  ): Promise<EventDetail>;
  getEvent(actor: Actor, communityId: string, eventSlug: string): Promise<EventWithOccurrences>;
  previewEventChange(
    actor: Actor,
    communityId: string,
    eventSlug: string,
    input: UpdateEventInput,
  ): Promise<EventChangePreview>;
  previewEventDelete(
    actor: Actor,
    communityId: string,
    eventSlug: string,
  ): Promise<EventDeletePreview>;
}

const upcomingOnEventPage = 10;
const maxSlugAttempts = 5;

export async function requireEvent(access: Access, eventSlug: string): Promise<EventRecord> {
  const event = await access.store.findEventBySlug(eventSlug);
  if (!event) {
    throw new CalendarNotFoundError("event");
  }
  return event;
}

async function upcomingDates(access: Access, eventId: string, now: Date): Promise<string[]> {
  return (await access.store.listEventOccurrences(eventId))
    .filter((o) => o.canceledAt === null && o.endsAt.getTime() > now.getTime())
    .map((o) => o.id);
}

export function createEventOperations(runtime: Runtime): EventOperations {
  return {
    async createEvent(actor, communityId, input) {
      const { detail, notice } = await withWriteAccess(
        runtime,
        actor,
        communityId,
        async (access) => {
          assertCan(actor, "create", "event", access.context);
          const parsed = parse(createEventInputSchema, input);
          if (parsed.notifyMembers && actor.kind === "user" && actor.credential) {
            throw new ForbiddenError("notify_members", "event");
          }
          checkCoverKey(access.community.id, parsed.coverKey);
          const rule: SeriesRule = {
            startsAtLocal: parsed.startsAtLocal,
            timeZone: parsed.timeZone,
            durationMinutes: parsed.durationMinutes,
            recurrence: parsed.recurrence ?? null,
            recurrenceUntil: parsed.recurrenceUntil ?? null,
          };
          checkRule(rule);
          const fields = {
            ...rule,
            title: parsed.title,
            description: parsed.description || null,
            location: parsed.location || null,
            coverKey: parsed.coverKey ?? null,
          };
          let event: EventRecord | null = null;
          for (let attempt = 0; attempt < maxSlugAttempts && !event; attempt += 1) {
            const root = slugify(parsed.title);
            const slug = nextFreeSlug(root, await access.store.eventSlugsLike(root || "event"));
            event = await access.store.insertEvent({ ...fields, slug });
          }
          if (!event) {
            throw new Error("could not find a free event slug");
          }
          const eventId = event.id;
          await access.store.insertOccurrences(
            planForRule(rule, runtime.now()).map((occurrence) => ({ eventId, ...occurrence })),
          );
          const notice =
            parsed.notifyMembers && access.viewerId
              ? {
                  kind: "event_created" as const,
                  communityId: access.community.id,
                  eventId,
                  actorId: access.viewerId,
                }
              : null;
          return { detail: toEventDetail(event, true), notice };
        },
      );
      if (notice) {
        await scheduleNotice(runtime, notice);
      }
      return detail;
    },

    async updateEvent(actor, communityId, eventSlug, input) {
      const { detail, timeChange } = await withWriteAccess(
        runtime,
        actor,
        communityId,
        async (access) => {
          assertCan(actor, "update", "event", access.context);
          const patch = parse(updateEventInputSchema, input);
          checkCoverKey(access.community.id, patch.coverKey);
          const current = await requireEvent(access, eventSlug);
          const now = runtime.now();
          const { previous, rule, plan, moves, baseline } = await planScheduleChange(
            access,
            current,
            patch,
            now,
          );
          const updated = await access.store.updateEvent(current.id, {
            ...rule,
            ...(patch.title === undefined ? {} : { title: patch.title }),
            ...(patch.description === undefined ? {} : { description: patch.description || null }),
            ...(patch.location === undefined ? {} : { location: patch.location || null }),
            ...(patch.coverKey === undefined ? {} : { coverKey: patch.coverKey }),
          });
          const removals = removalsOf(
            await access.store.listGoingUsers(plan.remove),
            access.viewerId,
          );
          await access.store.deleteOccurrences(plan.remove);
          await access.store.retimeOccurrences(plan.retime);
          await access.store.insertOccurrences(plan.insert);
          const timeChange: TimeChangeJobInput | null =
            moves.length === 0 && removals.length === 0
              ? null
              : {
                  communityId: access.community.id,
                  eventId: current.id,
                  editorId: access.viewerId,
                  changedAt: now.toISOString(),
                  previousZone: previous.timeZone,
                  baseline:
                    moves.length === 0
                      ? []
                      : baseline.map((entry) => ({
                          occurrenceId: entry.occurrenceId,
                          previousStart: entry.previousStart.toISOString(),
                        })),
                  removals,
                };
          return { detail: toEventDetail(updated, true), timeChange };
        },
      );
      if (timeChange && runtime.queue) {
        try {
          await runtime.queue.scheduleTimeChange(timeChange);
        } catch (error: unknown) {
          runtime.onQueueError(error, timeChange);
        }
      }
      return detail;
    },

    async deleteEvent(actor, communityId, eventSlug) {
      const notice = await withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "delete", "event", access.context);
        const event = await requireEvent(access, eventSlug);
        const upcoming = await upcomingDates(access, event.id, runtime.now());
        const going = await access.store.listGoingUsers(upcoming);
        await access.store.deleteEvent(event.id);
        return {
          kind: "event_deleted" as const,
          communityId,
          eventId: event.id,
          title: event.title,
          timeZone: event.timeZone,
          durationMinutes: event.durationMinutes,
          attendees: going.slice(0, maxDeletedAttendees).map((entry) => ({
            occurrenceId: entry.occurrenceId,
            userId: entry.userId,
            startsAt: entry.startsAt,
          })),
        };
      });
      if (notice.attendees.length > 0) {
        await scheduleNotice(runtime, notice);
      }
    },

    setRecordingUrl(actor, communityId, eventSlug, input) {
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "update", "event", access.context);
        const { recordingUrl } = parse(recordingInputSchema, input);
        const event = await requireEvent(access, eventSlug);
        return toEventDetail(await access.store.updateEvent(event.id, { recordingUrl }), true);
      });
    },

    previewEventChange(actor, communityId, eventSlug, input) {
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "update", "event", access.context);
        const patch = parse(updateEventInputSchema, input);
        const current = await requireEvent(access, eventSlug);
        const { plan, moves } = await planScheduleChange(access, current, patch, runtime.now());
        const [moving, removing] = await Promise.all([
          access.store.listGoingUsers(moves.map((move) => move.occurrenceId)),
          access.store.listGoingUsers(plan.remove),
        ]);
        return {
          moving: countPeople(moving, access.viewerId),
          removing: countPeople(removing, access.viewerId),
        };
      });
    },

    previewEventDelete(actor, communityId, eventSlug) {
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "delete", "event", access.context);
        const event = await requireEvent(access, eventSlug);
        const upcoming = await upcomingDates(access, event.id, runtime.now());
        const going = await access.store.listGoingUsers(upcoming);
        return { rsvps: going.length, dates: upcoming.length };
      });
    },

    getEvent(actor, communityId, eventSlug) {
      return withAccess(runtime, actor, communityId, async (access) => {
        const event = await requireEvent(access, eventSlug);
        const upcoming = await access.store.listEventUpcoming(
          event.id,
          runtime.now(),
          upcomingOnEventPage,
          access.viewerId,
        );
        return {
          ...toEventDetail(event, access.detailsVisible),
          upcoming: await presentOccurrences(access, upcoming),
        };
      });
    },
  };
}
