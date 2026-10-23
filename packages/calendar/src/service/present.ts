import type { EventRecord, OccurrenceRow } from "../repository";
import type {
  EventDetail,
  EventSummary,
  GoingFace,
  OccurrenceDetail,
  OccurrenceView,
} from "../views";
import { formatWallClock, parseWallClock } from "../wall-clock";
import type { Access } from "./context";

export const goingFacesShown = 5;

export function localStart(event: EventRecord): string {
  const clock = parseWallClock(event.startsAtLocal);
  if (!clock) {
    throw new Error("stored wall clock is invalid");
  }
  return formatWallClock(clock);
}

export function toEventSummary(event: EventRecord): EventSummary {
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    startsAtLocal: localStart(event),
    timeZone: event.timeZone,
    durationMinutes: event.durationMinutes,
    recurrence: event.recurrence === "weekly" ? "weekly" : null,
    recurrenceUntil: event.recurrenceUntil,
  };
}

export function toEventDetail(event: EventRecord, detailsVisible: boolean): EventDetail {
  return {
    ...toEventSummary(event),
    description: detailsVisible ? event.description : null,
    location: detailsVisible ? event.location : null,
    recordingUrl: detailsVisible ? event.recordingUrl : null,
    coverKey: event.coverKey,
    detailsVisible,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

export function toOccurrenceView(
  row: OccurrenceRow,
  detailsVisible: boolean,
  going: readonly GoingFace[] = [],
): OccurrenceView {
  return {
    id: row.occurrence.id,
    eventId: row.event.id,
    startsAt: row.occurrence.startsAt,
    endsAt: row.occurrence.endsAt,
    canceledAt: row.occurrence.canceledAt,
    event: toEventSummary(row.event),
    viewerRsvp: row.viewerRsvp,
    goingCount: row.goingCount,
    going,
    recordingUrl: detailsVisible ? row.event.recordingUrl : null,
  };
}

export function toOccurrenceDetail(
  row: OccurrenceRow,
  detailsVisible: boolean,
  going: readonly GoingFace[] = [],
): OccurrenceDetail {
  return {
    ...toOccurrenceView(row, detailsVisible, going),
    event: toEventDetail(row.event, detailsVisible),
  };
}

async function facesFor(
  access: Access,
  rows: readonly OccurrenceRow[],
): Promise<Map<string, GoingFace[]>> {
  const faces = new Map<string, GoingFace[]>();
  if (!access.detailsVisible || rows.length === 0) {
    return faces;
  }
  const found = await access.store.listGoingFaces(
    rows.map((row) => row.occurrence.id),
    goingFacesShown,
  );
  for (const { occurrenceId, ...face } of found) {
    faces.set(occurrenceId, [...(faces.get(occurrenceId) ?? []), face]);
  }
  return faces;
}

export async function presentOccurrences(
  access: Access,
  rows: readonly OccurrenceRow[],
): Promise<OccurrenceView[]> {
  const faces = await facesFor(access, rows);
  return rows.map((row) =>
    toOccurrenceView(row, access.detailsVisible, faces.get(row.occurrence.id)),
  );
}

export async function presentOccurrenceDetail(
  access: Access,
  row: OccurrenceRow,
): Promise<OccurrenceDetail> {
  const faces = await facesFor(access, [row]);
  return toOccurrenceDetail(row, access.detailsVisible, faces.get(row.occurrence.id));
}
