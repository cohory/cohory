import type { EventDetail, OccurrenceDetail, OccurrenceView } from "@cohory/calendar";
import {
  canonicalZone,
  dateKey,
  formatDayKey,
  type EventDetailEvent,
  type EventFormValue,
  type EventListGroup,
  type EventLocation,
  type EventOccurrence,
} from "@cohory/ui";

import { uploadHref } from "../courses/hrefs";
import { pastLimit } from "./params";

export function coverUrl(coverKey: string | null): string | null {
  return coverKey ? uploadHref(coverKey) : null;
}

export function toEventLocation(location: string | null): EventLocation | null {
  const text = location?.trim();
  if (!text) return null;
  if (/^https?:\/\/\S+$/i.test(text)) {
    try {
      return { kind: "link", url: new URL(text).toString() };
    } catch {
      return { kind: "text", text };
    }
  }
  return { kind: "text", text };
}

export function toEventOccurrence(
  view: OccurrenceView | OccurrenceDetail,
  location: string | null = null,
): EventOccurrence {
  return {
    id: view.id,
    eventSlug: view.event.slug,
    title: view.event.title,
    startsAt: view.startsAt.toISOString(),
    endsAt: view.endsAt.toISOString(),
    canceled: view.canceledAt !== null,
    recurrence: view.event.recurrence,
    goingCount: view.goingCount,
    viewerStatus: view.viewerRsvp,
    locationKind: toEventLocation(location)?.kind ?? null,
    going: view.going,
    recordingUrl: view.recordingUrl,
  };
}

export function toDetailOccurrence(detail: OccurrenceDetail): EventOccurrence {
  return toEventOccurrence(detail, detail.event.location);
}

export function toDetailEvent(detail: OccurrenceDetail): EventDetailEvent {
  return {
    description: detail.event.description ?? "",
    timeZone: detail.event.timeZone,
    location: toEventLocation(detail.event.location),
    recordingUrl: detail.event.recordingUrl,
    recurrenceUntil: detail.event.recurrenceUntil,
    coverUrl: coverUrl(detail.event.coverKey),
  };
}

export function groupByDay(
  occurrences: readonly EventOccurrence[],
  timeZone: string,
  locale?: string,
): EventListGroup[] {
  const groups = new Map<string, EventOccurrence[]>();
  const sorted = [...occurrences].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const occurrence of sorted) {
    const key = dateKey(occurrence.startsAt, timeZone);
    groups.set(key, [...(groups.get(key) ?? []), occurrence]);
  }
  return [...groups].map(([key, items]) => ({
    dateLabel: formatDayKey(key, locale),
    occurrences: items,
  }));
}

export function inMonth(
  occurrences: readonly EventOccurrence[],
  month: string,
  timeZone: string,
): EventOccurrence[] {
  return occurrences.filter((occurrence) =>
    dateKey(occurrence.startsAt, timeZone).startsWith(month),
  );
}

export function onDay(
  occurrences: readonly EventOccurrence[],
  day: string,
  timeZone: string,
): EventOccurrence[] {
  return occurrences.filter((occurrence) => dateKey(occurrence.startsAt, timeZone) === day);
}

export function pastOnly(occurrences: readonly EventOccurrence[], now: Date): EventOccurrence[] {
  const cutoff = now.toISOString();
  return occurrences
    .filter((occurrence) => !occurrence.canceled && occurrence.endsAt <= cutoff)
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, pastLimit);
}

export function toFormValue(event: EventDetail): EventFormValue {
  return {
    title: event.title,
    description: event.description ?? "",
    date: event.startsAtLocal.slice(0, 10),
    time: event.startsAtLocal.slice(11, 16),
    timeZone: event.timeZone,
    durationMinutes: event.durationMinutes,
    recurrence: event.recurrence,
    recurrenceUntil: event.recurrenceUntil ?? "",
    location: event.location ?? "",
    coverKey: event.coverKey,
    coverUrl: coverUrl(event.coverKey),
  };
}

export function emptyFormValue(timeZone: string, now: Date): EventFormValue {
  const tomorrow = new Date(now.getTime() + 86_400_000);
  return {
    title: "",
    description: "",
    date: dateKey(tomorrow.toISOString(), timeZone),
    time: "18:00",
    timeZone,
    durationMinutes: 60,
    recurrence: null,
    recurrenceUntil: "",
    location: "",
    coverKey: null,
    coverUrl: null,
  };
}

export function timeZoneOptions(viewerZone: string): string[] {
  const supported = Intl.supportedValuesOf("timeZone").map(canonicalZone);
  const zones = new Set([...supported, "UTC", canonicalZone(viewerZone)]);
  return [...zones].sort((a, b) => a.localeCompare(b));
}
