import type { EventOccurrence } from "./types";

export function occurrence(overrides: Partial<EventOccurrence> = {}): EventOccurrence {
  return {
    id: "occ-1",
    eventSlug: "weekly-call",
    title: "Weekly call",
    startsAt: "2026-11-03T17:00:00Z",
    endsAt: "2026-11-03T18:00:00Z",
    canceled: false,
    recurrence: null,
    goingCount: 12,
    viewerStatus: null,
    locationKind: "link",
    ...overrides,
  };
}
