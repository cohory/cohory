import type { EventRsvpStatus } from "@cohory/db/schema";

import type { Recurrence } from "./occurrences";

export type RsvpStatus = EventRsvpStatus;

export interface EventSummary {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly startsAtLocal: string;
  readonly timeZone: string;
  readonly durationMinutes: number;
  readonly recurrence: Recurrence | null;
  readonly recurrenceUntil: string | null;
}

export interface EventDetail extends EventSummary {
  readonly description: string | null;
  readonly location: string | null;
  readonly recordingUrl: string | null;
  readonly coverKey: string | null;
  readonly detailsVisible: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OccurrenceView {
  readonly id: string;
  readonly eventId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly canceledAt: Date | null;
  readonly event: EventSummary;
  readonly viewerRsvp: RsvpStatus | null;
  readonly goingCount: number;
  readonly going: readonly GoingFace[];
  readonly recordingUrl: string | null;
}

export type NextEventTeaser =
  | { readonly kind: "event"; readonly title: string; readonly startsAt: Date }
  | { readonly kind: "date"; readonly date: string };

export interface GoingFace {
  readonly userId: string;
  readonly name: string;
  readonly image: string | null;
}

export interface OccurrenceDetail extends Omit<OccurrenceView, "event"> {
  readonly event: EventDetail;
}

export interface EventWithOccurrences extends EventDetail {
  readonly upcoming: readonly OccurrenceView[];
}

export interface RsvpResult {
  readonly occurrenceId: string;
  readonly status: RsvpStatus;
  readonly goingCount: number;
}

export interface IcsFile {
  readonly filename: string;
  readonly content: string;
}

export interface RsvpPerson {
  readonly userId: string;
  readonly name: string;
  readonly username: string | null;
  readonly image: string | null;
  readonly respondedAt: Date;
}

export interface OccurrenceRsvpList {
  readonly occurrenceId: string;
  readonly goingCount: number;
  readonly going: readonly RsvpPerson[];
}

export interface EventDeletePreview {
  readonly rsvps: number;
  readonly dates: number;
}

export interface EventChangePreview {
  readonly moving: number;
  readonly removing: number;
}
