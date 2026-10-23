import { can, ForbiddenError, UnauthenticatedError } from "@cohory/authz";
import {
  CalendarError,
  getCalendarService,
  type OccurrenceDetail,
  type OccurrenceView,
} from "@cohory/calendar";
import { monthKey, type EventOccurrence } from "@cohory/ui";
import { notFound } from "next/navigation";
import { cache } from "react";

import { requireFullCommunityPage, type FullCommunityPage } from "../communities/load";
import { listRange, monthRange, pastRange, type CalendarView } from "./params";
import { viewerTimeZone, type ViewerTimeZone } from "./viewer-time-zone";
import { pastOnly, toEventOccurrence } from "./views";

function eventContext(page: FullCommunityPage) {
  return {
    role: page.role,
    communityPrivacy: page.community.privacy,
    entitled: page.entitled,
  };
}

export function canManageEvents(page: FullCommunityPage): boolean {
  return can(page.actor, "create", "event", eventContext(page));
}

export function canRsvpEvents(page: FullCommunityPage): boolean {
  return can(page.actor, "rsvp", "event", eventContext(page));
}

function isHidden(error: unknown): boolean {
  return (
    error instanceof CalendarError ||
    error instanceof ForbiddenError ||
    error instanceof UnauthenticatedError
  );
}

export interface CalendarRequest {
  readonly view: CalendarView | null;
  readonly month: string | null;
}

export type CalendarData =
  | {
      readonly status: "forbidden";
      readonly page: FullCommunityPage;
      readonly zone: ViewerTimeZone;
    }
  | {
      readonly status: "ok";
      readonly page: FullCommunityPage;
      readonly zone: ViewerTimeZone;
      readonly month: string;
      readonly monthOccurrences: EventOccurrence[] | null;
      readonly listOccurrences: EventOccurrence[] | null;
      readonly pastOccurrences: EventOccurrence[];
      readonly manager: boolean;
      readonly canRsvp: boolean;
    };

export function toOccurrences(views: readonly OccurrenceView[]): EventOccurrence[] {
  return views.map((view) => toEventOccurrence(view));
}

export async function loadCalendar(
  slug: string,
  request: CalendarRequest,
  now: Date = new Date(),
): Promise<CalendarData> {
  const page = await requireFullCommunityPage(slug);
  const zone = await viewerTimeZone();
  const month = request.month ?? monthKey(now.toISOString(), zone.timeZone);
  const service = getCalendarService();
  const list = (range: { from: Date; to: Date }) =>
    service.listOccurrences(page.actor, page.community.id, range).then(toOccurrences);
  try {
    const [monthOccurrences, listOccurrences, past] = await Promise.all([
      request.view === "list" ? null : list(monthRange(month)),
      request.view === "month" ? null : list(listRange(now)),
      request.view === "month" ? [] : list(pastRange(now)),
    ]);
    return {
      status: "ok",
      page,
      zone,
      month,
      monthOccurrences,
      listOccurrences,
      pastOccurrences: pastOnly(past, now),
      manager: canManageEvents(page),
      canRsvp: canRsvpEvents(page),
    };
  } catch (error) {
    if (isHidden(error)) return { status: "forbidden", page, zone };
    throw error;
  }
}

export interface OccurrenceData {
  readonly page: FullCommunityPage;
  readonly detail: OccurrenceDetail;
  readonly zone: ViewerTimeZone;
  readonly manager: boolean;
  readonly canRsvp: boolean;
}

export const loadOccurrence = cache(
  async (slug: string, eventSlug: string, occurrenceId: string): Promise<OccurrenceData> => {
    const page = await requireFullCommunityPage(slug);
    let detail: OccurrenceDetail;
    try {
      detail = await getCalendarService().getOccurrence(
        page.actor,
        page.community.id,
        eventSlug,
        occurrenceId,
      );
    } catch (error) {
      if (isHidden(error)) notFound();
      throw error;
    }
    return {
      page,
      detail,
      zone: await viewerTimeZone(detail.event.timeZone),
      manager: canManageEvents(page),
      canRsvp: canRsvpEvents(page) && detail.event.detailsVisible,
    };
  },
);

export async function loadUpcomingForViewer(page: FullCommunityPage): Promise<EventOccurrence[]> {
  if (page.role === null || page.actor.kind !== "user") return [];
  try {
    const views = await getCalendarService().getUpcomingForViewer(page.actor, page.community.id);
    return toOccurrences(views);
  } catch (error) {
    if (isHidden(error)) return [];
    throw error;
  }
}

export const loadNextForViewer = cache(
  async (page: FullCommunityPage): Promise<EventOccurrence[]> => {
    if (page.role === null || page.actor.kind !== "user") return [];
    try {
      const views = await getCalendarService().getNextForViewer(page.actor, page.community.id);
      return toOccurrences(views);
    } catch (error) {
      if (isHidden(error)) return [];
      throw error;
    }
  },
);
