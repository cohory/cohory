import type { OccurrenceDetail, OccurrenceView } from "@cohory/calendar";
import { describe, expect, it } from "vitest";

import {
  emptyFormValue,
  groupByDay,
  inMonth,
  toDetailEvent,
  toDetailOccurrence,
  toEventLocation,
  toEventOccurrence,
  pastOnly,
  timeZoneOptions,
  toFormValue,
} from "./views";

const summary = {
  id: "0199e0a0-0000-7000-8000-000000000001",
  slug: "weekly-call",
  title: "Weekly call",
  startsAtLocal: "2026-11-03T18:00",
  timeZone: "Europe/Berlin",
  durationMinutes: 60,
  recurrence: "weekly" as const,
  recurrenceUntil: "2027-01-05",
};

const view: OccurrenceView = {
  id: "0199e0a0-0000-7000-8000-000000000002",
  eventId: summary.id,
  startsAt: new Date("2026-11-03T17:00:00Z"),
  endsAt: new Date("2026-11-03T18:00:00Z"),
  canceledAt: null,
  event: summary,
  viewerRsvp: "going",
  goingCount: 4,
  going: [{ userId: "u1", name: "Ada Lovelace", image: null }],
  recordingUrl: null,
};

const detail: OccurrenceDetail = {
  ...view,
  canceledAt: new Date("2026-10-30T09:00:00Z"),
  event: {
    ...summary,
    description: "Bring questions.",
    location: "https://meet.example.com/weekly",
    recordingUrl: null,
    coverKey: "communities/c1/uploads/cover.png",
    detailsVisible: true,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
  },
};

describe("calendar view mapping", () => {
  it("maps an occurrence view to EventCard props in ISO strings", () => {
    expect(toEventOccurrence(view)).toEqual({
      id: view.id,
      eventSlug: "weekly-call",
      title: "Weekly call",
      startsAt: "2026-11-03T17:00:00.000Z",
      endsAt: "2026-11-03T18:00:00.000Z",
      canceled: false,
      recurrence: "weekly",
      goingCount: 4,
      viewerStatus: "going",
      locationKind: null,
      going: [{ userId: "u1", name: "Ada Lovelace", image: null }],
      recordingUrl: null,
    });
  });

  it("marks canceled occurrences and derives the location kind on details", () => {
    const occurrence = toDetailOccurrence(detail);
    expect(occurrence.canceled).toBe(true);
    expect(occurrence.locationKind).toBe("link");
    expect(toDetailEvent(detail)).toEqual({
      description: "Bring questions.",
      timeZone: "Europe/Berlin",
      location: { kind: "link", url: "https://meet.example.com/weekly" },
      recordingUrl: null,
      recurrenceUntil: "2027-01-05",
      coverUrl: "/api/uploads/communities/c1/uploads/cover.png",
    });
  });

  it("hides the location when the service withholds details", () => {
    const hidden = { ...detail, event: { ...detail.event, location: null, description: null } };
    expect(toDetailEvent(hidden).location).toBeNull();
    expect(toDetailEvent(hidden).description).toBe("");
  });

  it("treats anything other than an http link as a text location", () => {
    expect(toEventLocation("Main hall")).toEqual({ kind: "text", text: "Main hall" });
    expect(toEventLocation("javascript:alert(1)")).toEqual({
      kind: "text",
      text: "javascript:alert(1)",
    });
    expect(toEventLocation("  ")).toBeNull();
  });

  it("groups occurrences by day in the viewer zone", () => {
    const late = toEventOccurrence({
      ...view,
      id: "late",
      startsAt: new Date("2026-11-03T23:30:00Z"),
      endsAt: new Date("2026-11-04T00:30:00Z"),
    });
    const early = toEventOccurrence({
      ...view,
      startsAt: new Date("2026-11-03T10:00:00Z"),
      endsAt: new Date("2026-11-03T11:00:00Z"),
    });
    expect(groupByDay([late, early], "UTC").map((group) => group.occurrences.length)).toEqual([2]);
    const tokyo = groupByDay([late, early], "Asia/Tokyo");
    expect(tokyo.map((group) => group.dateLabel)).toEqual([
      "Tuesday, 3 November 2026",
      "Wednesday, 4 November 2026",
    ]);
    expect(inMonth([late, early], "2026-11", "UTC")).toHaveLength(2);
    expect(inMonth([late, early], "2026-10", "UTC")).toHaveLength(0);
  });

  it("prefills the edit form from the event wall clock", () => {
    expect(toFormValue(detail.event)).toEqual({
      title: "Weekly call",
      description: "Bring questions.",
      date: "2026-11-03",
      time: "18:00",
      timeZone: "Europe/Berlin",
      durationMinutes: 60,
      recurrence: "weekly",
      recurrenceUntil: "2027-01-05",
      location: "https://meet.example.com/weekly",
      coverKey: "communities/c1/uploads/cover.png",
      coverUrl: "/api/uploads/communities/c1/uploads/cover.png",
    });
  });

  it("starts a new event tomorrow in the viewer zone", () => {
    const value = emptyFormValue("Pacific/Auckland", new Date("2026-10-18T20:00:00Z"));
    expect(value.date).toBe("2026-10-20");
    expect(value.timeZone).toBe("Pacific/Auckland");
    expect(value.coverKey).toBeNull();
  });

  it("lists finished, uncanceled occurrences newest first", () => {
    const at = (iso: string, id: string, canceled = false) => ({
      ...toEventOccurrence(view),
      id,
      startsAt: iso,
      endsAt: new Date(new Date(iso).getTime() + 3_600_000).toISOString(),
      canceled,
    });
    const past = pastOnly(
      [
        at("2026-10-01T10:00:00.000Z", "old"),
        at("2026-10-08T10:00:00.000Z", "newer"),
        at("2026-10-09T10:00:00.000Z", "canceled", true),
        at("2026-10-15T11:30:00.000Z", "running"),
      ],
      new Date("2026-10-15T12:00:00Z"),
    );
    expect(past.map((occurrence) => occurrence.id)).toEqual(["newer", "old"]);
  });

  it("offers current zone names and drops renamed ones", () => {
    const zones = timeZoneOptions("Asia/Calcutta");
    expect(zones).toContain("Asia/Kolkata");
    expect(zones).toContain("Europe/Kyiv");
    expect(zones).not.toContain("Asia/Calcutta");
    expect(zones).not.toContain("Europe/Kiev");
  });
});
