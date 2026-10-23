type RsvpStatus = "going" | "not_going";

type EventRecurrence = "weekly";

type EventLocationKind = "link" | "text";

interface EventGoingFace {
  userId: string;
  name: string;
  image: string | null;
}

interface EventOccurrence {
  id: string;
  eventSlug: string;
  title: string;
  startsAt: string;
  endsAt: string;
  canceled: boolean;
  recurrence: EventRecurrence | null;
  goingCount: number;
  viewerStatus: RsvpStatus | null;
  locationKind: EventLocationKind | null;
  going?: readonly EventGoingFace[];
  recordingUrl?: string | null;
}

type EventLocation = { kind: "link"; url: string } | { kind: "text"; text: string };

export type {
  EventGoingFace,
  EventLocation,
  EventLocationKind,
  EventOccurrence,
  EventRecurrence,
  RsvpStatus,
};
