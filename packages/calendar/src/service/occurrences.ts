import { assertCan, type Actor } from "@cohory/authz";

import { CalendarNotFoundError, CalendarValidationError } from "../errors";
import { buildIcs } from "../ics";
import type { OccurrenceRow } from "../repository";
import { rangeInputSchema, rsvpInputSchema, type RangeInput, type RsvpInput } from "../schemas";
import type {
  IcsFile,
  OccurrenceDetail,
  OccurrenceRsvpList,
  OccurrenceView,
  RsvpResult,
} from "../views";
import {
  calendarUrl,
  isUuid,
  parse,
  requireUserId,
  withAccess,
  withWriteAccess,
  type Access,
  type Runtime,
} from "./context";
import { requireEvent, ruleOf } from "./events";
import { occurrenceIcs } from "./ics-file";
import { scheduleNotice } from "./notify";
import {
  localStart,
  presentOccurrenceDetail,
  presentOccurrences,
  toOccurrenceView,
} from "./present";

export interface OccurrenceOperations {
  listOccurrences(actor: Actor, communityId: string, range: RangeInput): Promise<OccurrenceView[]>;
  getOccurrence(
    actor: Actor,
    communityId: string,
    eventSlug: string,
    occurrenceId: string,
  ): Promise<OccurrenceDetail>;
  cancelOccurrence(
    actor: Actor,
    communityId: string,
    occurrenceId: string,
  ): Promise<OccurrenceView>;
  uncancelOccurrence(
    actor: Actor,
    communityId: string,
    occurrenceId: string,
  ): Promise<OccurrenceView>;
  rsvp(
    actor: Actor,
    communityId: string,
    occurrenceId: string,
    input: RsvpInput,
  ): Promise<RsvpResult>;
  listOccurrenceRsvps(
    actor: Actor,
    communityId: string,
    occurrenceId: string,
  ): Promise<OccurrenceRsvpList>;
  getUpcomingForViewer(actor: Actor, communityId: string): Promise<OccurrenceView[]>;
  getNextForViewer(actor: Actor, communityId: string): Promise<OccurrenceView[]>;
  icsForOccurrence(actor: Actor, communityId: string, occurrenceId: string): Promise<IcsFile>;
  icsForEvent(actor: Actor, communityId: string, eventSlug: string): Promise<IcsFile>;
}

export const upcomingForViewerLimit = 3;
export const nextForViewerLimit = 2;
const nextForViewerWindowMs = 90 * 24 * 60 * 60 * 1000;
export const rsvpListLimit = 1000;

async function requireOccurrence(access: Access, occurrenceId: string): Promise<OccurrenceRow> {
  const row = isUuid(occurrenceId)
    ? await access.store.findOccurrence(occurrenceId, access.viewerId)
    : null;
  if (!row) {
    throw new CalendarNotFoundError("occurrence");
  }
  return row;
}

export function createOccurrenceOperations(runtime: Runtime): OccurrenceOperations {
  async function setCanceled(
    actor: Actor,
    communityId: string,
    occurrenceId: string,
    cancel: boolean,
  ) {
    const { view, changed } = await withWriteAccess(runtime, actor, communityId, async (access) => {
      assertCan(actor, "cancel_occurrence", "event", access.context);
      const row = await requireOccurrence(access, occurrenceId);
      await access.store.setOccurrenceCanceled(row.occurrence.id, cancel ? runtime.now() : null);
      return {
        view: toOccurrenceView(
          await requireOccurrence(access, row.occurrence.id),
          access.detailsVisible,
        ),
        changed: (row.occurrence.canceledAt !== null) !== cancel,
      };
    });
    if (changed) {
      await scheduleNotice(runtime, { kind: "date_status", communityId, occurrenceId: view.id });
    }
    return view;
  }

  return {
    listOccurrenceRsvps(actor, communityId, occurrenceId) {
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "read_rsvps", "event", access.context);
        const row = await requireOccurrence(access, occurrenceId);
        const going = await access.store.listGoingPeople(row.occurrence.id, rsvpListLimit);
        return { occurrenceId: row.occurrence.id, goingCount: row.goingCount, going };
      });
    },

    listOccurrences(actor, communityId, range) {
      return withAccess(runtime, actor, communityId, async (access) => {
        const { from, to } = parse(rangeInputSchema, range);
        const found = await access.store.listOccurrences({ from, to }, access.viewerId);
        return presentOccurrences(access, found);
      });
    },

    getOccurrence(actor, communityId, eventSlug, occurrenceId) {
      return withAccess(runtime, actor, communityId, async (access) => {
        const row = await requireOccurrence(access, occurrenceId);
        if (row.event.slug.toLowerCase() !== eventSlug.toLowerCase()) {
          throw new CalendarNotFoundError("occurrence");
        }
        return presentOccurrenceDetail(access, row);
      });
    },

    cancelOccurrence(actor, communityId, occurrenceId) {
      return setCanceled(actor, communityId, occurrenceId, true);
    },

    uncancelOccurrence(actor, communityId, occurrenceId) {
      return setCanceled(actor, communityId, occurrenceId, false);
    },

    async rsvp(actor, communityId, occurrenceId, input) {
      const { result, started, stopped } = await withWriteAccess(
        runtime,
        actor,
        communityId,
        async (access) => {
          const userId = requireUserId(actor);
          runtime.rateLimit("rsvp", userId);
          assertCan(actor, "rsvp", "event", access.context);
          const { status } = parse(rsvpInputSchema, input);
          const row = await requireOccurrence(access, occurrenceId);
          if (row.occurrence.canceledAt !== null) {
            throw new CalendarValidationError([
              { path: "occurrenceId", message: "This occurrence is canceled." },
            ]);
          }
          if (row.occurrence.endsAt.getTime() <= runtime.now().getTime()) {
            throw new CalendarValidationError([
              { path: "occurrenceId", message: "This occurrence has already ended." },
            ]);
          }
          await access.store.upsertRsvp(row.occurrence.id, userId, status);
          const after = await requireOccurrence(access, row.occurrence.id);
          return {
            result: { occurrenceId: row.occurrence.id, status, goingCount: after.goingCount },
            started: status === "going" && row.viewerRsvp !== "going" ? userId : null,
            stopped: status === "not_going" && row.viewerRsvp === "going" ? userId : null,
          };
        },
      );
      if (started) {
        await scheduleNotice(runtime, {
          kind: "rsvp_going",
          communityId,
          occurrenceId: result.occurrenceId,
          userId: started,
        });
      }
      if (stopped) {
        await scheduleNotice(runtime, {
          kind: "rsvp_not_going",
          communityId,
          occurrenceId: result.occurrenceId,
          userId: stopped,
        });
      }
      return result;
    },

    getUpcomingForViewer(actor, communityId) {
      return withAccess(runtime, actor, communityId, async (access) => {
        const userId = requireUserId(actor);
        const going = await access.store.listGoing(userId, runtime.now(), upcomingForViewerLimit);
        return going.map((row) => toOccurrenceView(row, access.detailsVisible));
      });
    },

    getNextForViewer(actor, communityId) {
      return withAccess(runtime, actor, communityId, async (access) => {
        const userId = requireUserId(actor);
        const now = runtime.now();
        const going = await access.store.listGoing(userId, now, upcomingForViewerLimit);
        if (going.length > 0) {
          return going.map((row) => toOccurrenceView(row, access.detailsVisible));
        }
        const window = { from: now, to: new Date(now.getTime() + nextForViewerWindowMs) };
        const rows = await access.store.listOccurrences(window, userId);
        return rows
          .filter((row) => row.occurrence.canceledAt === null && row.viewerRsvp !== "not_going")
          .slice(0, nextForViewerLimit)
          .map((row) => toOccurrenceView(row, access.detailsVisible));
      });
    },

    icsForOccurrence(actor, communityId, occurrenceId) {
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "read", "event", access.context);
        const row = await requireOccurrence(access, occurrenceId);
        const content = occurrenceIcs(row, calendarUrl(runtime, access.community), runtime.now());
        const day = row.occurrence.startsAt.toISOString().slice(0, 10);
        return { filename: `${row.event.slug}-${day}.ics`, content };
      });
    },

    icsForEvent(actor, communityId, eventSlug) {
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "read", "event", access.context);
        const event = await requireEvent(access, eventSlug);
        const occurrences = await access.store.listEventOccurrences(event.id);
        const content = buildIcs({
          event: {
            ...ruleOf(event),
            startsAtLocal: localStart(event),
            eventId: event.id,
            title: event.title,
            description: event.description,
            location: event.location,
            canceledStarts: occurrences
              .filter((occurrence) => occurrence.canceledAt !== null)
              .map((occurrence) => occurrence.startsAt),
          },
          url: calendarUrl(runtime, access.community),
          now: runtime.now(),
        });
        return { filename: `${event.slug}.ics`, content };
      });
    },
  };
}
