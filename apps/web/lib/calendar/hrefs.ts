import type { CalendarView } from "./params";

const segment = (value: string) => encodeURIComponent(value);

export function calendarHref(
  slug: string,
  options: { view?: CalendarView | null; month?: string | null } = {},
): string {
  const query = new URLSearchParams();
  if (options.view) query.set("view", options.view);
  if (options.month) query.set("month", options.month);
  const search = query.toString();
  return `/c/${segment(slug)}/calendar${search ? `?${search}` : ""}`;
}

export function newEventHref(slug: string): string {
  return `/c/${segment(slug)}/calendar/new`;
}

export function occurrenceHref(
  slug: string,
  eventSlug: string,
  occurrenceId: string,
  options?: { edit?: boolean },
): string {
  const base = `/c/${segment(slug)}/calendar/${segment(eventSlug)}/${segment(occurrenceId)}`;
  return options?.edit ? `${base}?edit=1` : base;
}

function apiCalendar(slug: string): string {
  return `/api/v1/communities/${segment(slug)}/calendar`;
}

export function occurrenceIcsHref(slug: string, occurrenceId: string): string {
  return `${apiCalendar(slug)}/occurrences/${segment(occurrenceId)}/ics`;
}

export function eventIcsHref(slug: string, eventSlug: string): string {
  return `${apiCalendar(slug)}/events/${segment(eventSlug)}/ics`;
}
