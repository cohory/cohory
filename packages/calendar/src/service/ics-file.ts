import { buildIcs, type IcsEvent, type IcsInvite } from "../ics";
import type { EventRecord, OccurrenceRow } from "../repository";
import { localStart } from "./present";
import { ruleOf } from "./schedule-change";

export interface IcsOccurrence {
  readonly id: string;
  readonly startsAt: Date;
}

export function icsEventOf(event: EventRecord): IcsEvent {
  return {
    ...ruleOf(event),
    startsAtLocal: localStart(event),
    eventId: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    canceledStarts: [],
  };
}

export function singleDateIcs(
  event: IcsEvent,
  occurrence: IcsOccurrence,
  url: string | null,
  now: Date,
  invite?: IcsInvite,
): string {
  return buildIcs({ event, occurrence, url, now, invite });
}

export function occurrenceIcs(row: OccurrenceRow, url: string | null, now: Date): string {
  return singleDateIcs(icsEventOf(row.event), row.occurrence, url, now);
}
