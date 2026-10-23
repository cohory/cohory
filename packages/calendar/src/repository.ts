import type { CommunityPrivacy } from "@cohory/authz";
import type { CommunityId } from "@cohory/db";
import type { CommunityAccess } from "@cohory/entitlements/access";
import type {
  CommunityAppearance,
  eventOccurrences,
  events,
  EventRsvpStatus,
} from "@cohory/db/schema";

import type { OccurrenceRetime } from "./reconcile";

export type EventRecord = typeof events.$inferSelect;
export type OccurrenceRecord = typeof eventOccurrences.$inferSelect;

export interface CommunityRecord {
  readonly id: CommunityId;
  readonly slug: string;
  readonly name: string;
  readonly appearance: CommunityAppearance;
  readonly privacy: CommunityPrivacy;
  readonly archivedAt: Date | null;
}

export interface OccurrenceRow {
  readonly occurrence: OccurrenceRecord;
  readonly event: EventRecord;
  readonly viewerRsvp: EventRsvpStatus | null;
  readonly goingCount: number;
}

export type NewEvent = Pick<
  EventRecord,
  | "slug"
  | "title"
  | "description"
  | "startsAtLocal"
  | "timeZone"
  | "durationMinutes"
  | "recurrence"
  | "recurrenceUntil"
  | "location"
  | "coverKey"
>;

export type EventPatch = Partial<Omit<NewEvent, "slug"> & Pick<EventRecord, "recordingUrl">>;

export interface NewOccurrence {
  readonly eventId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface OccurrenceQuery {
  readonly from: Date;
  readonly to: Date;
}

export interface ReminderClaim {
  readonly occurrenceId: string;
  readonly eventSlug: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly title: string;
  readonly timeZone: string;
  readonly startsAt: Date;
  readonly location: string | null;
}

export interface DueOccurrence {
  readonly communityId: CommunityId;
  readonly occurrenceId: string;
}

export interface RsvpPersonRow {
  readonly userId: string;
  readonly name: string;
  readonly username: string | null;
  readonly image: string | null;
  readonly respondedAt: Date;
}

export interface GoingFaceRow {
  readonly occurrenceId: string;
  readonly userId: string;
  readonly name: string;
  readonly image: string | null;
}

export interface MemberRecipient {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
}

export interface GoingRecipient extends MemberRecipient {
  readonly occurrenceId: string;
  readonly startsAt: Date;
}

export interface GoingUser {
  readonly occurrenceId: string;
  readonly userId: string;
  readonly startsAt: Date;
}

export interface CalendarStore {
  findAccess(userId: string, now: Date): Promise<CommunityAccess>;
  enableManagement(): Promise<void>;

  eventSlugsLike(root: string): Promise<string[]>;
  insertEvent(event: NewEvent): Promise<EventRecord | null>;
  updateEvent(eventId: string, patch: EventPatch): Promise<EventRecord>;
  deleteEvent(eventId: string): Promise<void>;
  findEventBySlug(slug: string): Promise<EventRecord | null>;
  findEventById(eventId: string): Promise<EventRecord | null>;
  listWeeklyEvents(): Promise<EventRecord[]>;

  listEventOccurrences(eventId: string): Promise<OccurrenceRecord[]>;
  insertOccurrences(occurrences: readonly NewOccurrence[]): Promise<number>;
  deleteOccurrences(occurrenceIds: readonly string[]): Promise<void>;
  retimeOccurrences(retimes: readonly OccurrenceRetime[]): Promise<void>;
  setOccurrenceCanceled(occurrenceId: string, canceledAt: Date | null): Promise<void>;

  findOccurrence(occurrenceId: string, viewerId: string | null): Promise<OccurrenceRow | null>;
  listOccurrences(query: OccurrenceQuery, viewerId: string | null): Promise<OccurrenceRow[]>;
  findNextOccurrence(from: Date, until: Date): Promise<OccurrenceRow | null>;
  listEventUpcoming(
    eventId: string,
    now: Date,
    limit: number,
    viewerId: string | null,
  ): Promise<OccurrenceRow[]>;
  listGoing(userId: string, now: Date, limit: number): Promise<OccurrenceRow[]>;
  upsertRsvp(occurrenceId: string, userId: string, status: EventRsvpStatus): Promise<void>;
  listGoingPeople(occurrenceId: string, limit: number): Promise<RsvpPersonRow[]>;
  listGoingFaces(occurrenceIds: readonly string[], perOccurrence: number): Promise<GoingFaceRow[]>;
  listGoingUsers(occurrenceIds: readonly string[]): Promise<GoingUser[]>;
  listGoingRecipients(occurrenceIds: readonly string[]): Promise<GoingRecipient[]>;
  listMemberRecipients(userIds: readonly string[]): Promise<MemberRecipient[]>;

  claimReminders(occurrenceIds: readonly string[], at: Date): Promise<ReminderClaim[]>;
  clearReminders(occurrenceIds: readonly string[], sentBefore: Date): Promise<void>;
  releaseReminder(occurrenceId: string, userId: string, at: Date): Promise<void>;
}

export interface CalendarRepository {
  findCommunity(communityId: CommunityId): Promise<CommunityRecord | null>;
  inCommunity<T>(
    communityId: CommunityId,
    userId: string | null,
    fn: (store: CalendarStore) => Promise<T>,
  ): Promise<T>;
  inCommunityAsJob<T>(
    communityId: CommunityId,
    fn: (store: CalendarStore) => Promise<T>,
  ): Promise<T>;
  dueOccurrences(from: Date, to: Date): Promise<DueOccurrence[]>;
  communitiesWithSeries(now: Date): Promise<CommunityId[]>;
}
