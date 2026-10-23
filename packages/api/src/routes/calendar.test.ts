import { ForbiddenError } from "@cohory/authz";
import {
  CalendarNotFoundError,
  CalendarValidationError,
  type CalendarService,
  type EventDetail,
  type OccurrenceView,
} from "@cohory/calendar";
import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import { communitySlugSchema, newId } from "@cohory/db";
import { createPostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { apiDeps } from "../services";

import { createApi, createOpenApiDocument } from "../app";
import type { SessionResolver } from "../middleware/session";

const sessionHeader = "x-test-user";
const resolveSession: SessionResolver = async (headers) => {
  const userId = headers.get(sessionHeader);
  return userId ? { userId } : null;
};

type Stub = { [K in keyof CalendarService]: Mock<CalendarService[K]> };

function createStub(): Stub {
  return {
    createEvent: vi.fn<CalendarService["createEvent"]>(),
    updateEvent: vi.fn<CalendarService["updateEvent"]>(),
    deleteEvent: vi.fn<CalendarService["deleteEvent"]>(),
    setRecordingUrl: vi.fn<CalendarService["setRecordingUrl"]>(),
    getEvent: vi.fn<CalendarService["getEvent"]>(),
    previewEventChange: vi.fn<CalendarService["previewEventChange"]>(),
    listOccurrences: vi.fn<CalendarService["listOccurrences"]>(),
    getOccurrence: vi.fn<CalendarService["getOccurrence"]>(),
    cancelOccurrence: vi.fn<CalendarService["cancelOccurrence"]>(),
    uncancelOccurrence: vi.fn<CalendarService["uncancelOccurrence"]>(),
    rsvp: vi.fn<CalendarService["rsvp"]>(),
    listOccurrenceRsvps: vi.fn<CalendarService["listOccurrenceRsvps"]>(),
    getUpcomingForViewer: vi.fn<CalendarService["getUpcomingForViewer"]>(),
    getNextForViewer: vi.fn<CalendarService["getNextForViewer"]>(),
    icsForOccurrence: vi.fn<CalendarService["icsForOccurrence"]>(),
    icsForEvent: vi.fn<CalendarService["icsForEvent"]>(),
    previewEventDelete: vi.fn<CalendarService["previewEventDelete"]>(),
    nextEventTeaser: vi.fn<CalendarService["nextEventTeaser"]>(),
  };
}

const at = new Date("2026-10-01T10:00:00.000Z");
const occurrenceId = newId();

const event: EventDetail = {
  id: newId(),
  slug: "weekly-call",
  title: "Weekly call",
  startsAtLocal: "2026-10-18T18:00",
  timeZone: "Europe/Berlin",
  durationMinutes: 60,
  recurrence: "weekly",
  recurrenceUntil: null,
  description: null,
  location: "https://meet.example.com/x",
  recordingUrl: null,
  coverKey: null,
  detailsVisible: true,
  createdAt: at,
  updatedAt: at,
};

const occurrence: OccurrenceView = {
  id: occurrenceId,
  eventId: event.id,
  startsAt: new Date("2026-10-25T17:00:00.000Z"),
  endsAt: new Date("2026-10-25T18:00:00.000Z"),
  canceledAt: null,
  event,
  viewerRsvp: "going",
  goingCount: 3,
  going: [],
  recordingUrl: null,
};

let stub: Stub;
let api: ReturnType<typeof createApi>;
let communityId: string;
let member: string;

beforeEach(() => {
  const communitiesRepo = createFakeRepository();
  const community = communitiesRepo.addCommunity({
    slug: communitySlugSchema.parse("makers"),
    privacy: "private",
  });
  communityId = community.id;
  member = newId();
  communitiesRepo.addMembership({
    communityId: community.id,
    userId: member,
    role: "member",
    status: "active",
  });
  stub = createStub();
  api = createApi(() =>
    apiDeps({
      resolveSession,
      communities: createCommunitiesService(communitiesRepo),
      posts: createPostsService({
        repo: createFakePostsRepository(),
        storage: {
          put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
          publicUrl: (k) => k,
        },
      }),
      calendar: stub,
    }),
  );
});

async function call(
  path: string,
  init: { method?: string; userId?: string; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers();
  if (init.userId) headers.set(sessionHeader, init.userId);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return api.request(`/api/v1/communities/makers/calendar${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function error(response: Response): Promise<{ code: string; details?: unknown }> {
  return ((await response.json()) as { error: { code: string; details?: unknown } }).error;
}

describe("calendar routes", () => {
  it("lists occurrences in a range with ISO dates", async () => {
    stub.listOccurrences.mockResolvedValue([occurrence]);

    const response = await call("/occurrences?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z", {
      userId: member,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { startsAt: string; goingCount: number }[] };
    expect(body.data[0]).toMatchObject({ startsAt: "2026-10-25T17:00:00.000Z", goingCount: 3 });
    expect(stub.listOccurrences.mock.calls[0]?.[1]).toBe(communityId);
    expect(stub.listOccurrences.mock.calls[0]?.[2]).toEqual({
      from: new Date("2026-10-01T00:00:00Z"),
      to: new Date("2026-11-01T00:00:00Z"),
    });
  });

  it("answers 422 for a missing range and maps service validation issues", async () => {
    stub.createEvent.mockRejectedValue(
      new CalendarValidationError([{ path: "timeZone", message: "Use an IANA time zone." }]),
    );

    const missing = await call("/occurrences?from=2026-10-01T00:00:00Z", { userId: member });
    const invalid = await call("/events", {
      method: "POST",
      userId: member,
      body: {
        title: "x",
        startsAtLocal: "2026-10-18T18:00",
        timeZone: "Mars",
        durationMinutes: 60,
      },
    });

    expect(missing.status).toBe(422);
    expect(invalid.status).toBe(422);
    expect(await error(invalid)).toMatchObject({
      code: "validation_failed",
      details: [{ path: "timeZone", message: "Use an IANA time zone." }],
    });
  });

  it("creates events with 201 and maps policy denials to 403", async () => {
    stub.createEvent.mockResolvedValueOnce(event);
    stub.createEvent.mockRejectedValueOnce(new ForbiddenError("create", "event"));
    const body = {
      title: "Weekly call",
      startsAtLocal: "2026-10-18T18:00",
      timeZone: "Europe/Berlin",
      durationMinutes: 60,
      recurrence: "weekly",
    };

    const created = await call("/events", { method: "POST", userId: member, body });
    const denied = await call("/events", { method: "POST", userId: member, body });

    expect(created.status).toBe(201);
    expect(((await created.json()) as { slug: string }).slug).toBe("weekly-call");
    expect(denied.status).toBe(403);
    expect((await error(denied)).code).toBe("forbidden");
  });

  it("passes the cover and the notify members flag to the service and returns the cover", async () => {
    const coverKey = `communities/${communityId}/posts/cover.png`;
    stub.createEvent.mockResolvedValueOnce({ ...event, coverKey });
    const body = {
      title: "Weekly call",
      startsAtLocal: "2026-10-18T18:00",
      timeZone: "Europe/Berlin",
      durationMinutes: 60,
      coverKey,
      notifyMembers: true,
    };

    const created = await call("/events", { method: "POST", userId: member, body });

    expect(created.status).toBe(201);
    expect(stub.createEvent.mock.calls[0]?.[2]).toMatchObject({ coverKey, notifyMembers: true });
    expect(((await created.json()) as { coverKey: string | null }).coverKey).toBe(coverKey);
  });

  it("returns the recording link of a past date in occurrence lists", async () => {
    stub.listOccurrences.mockResolvedValue([
      { ...occurrence, recordingUrl: "https://v.example.com/replay" },
    ]);

    const response = await call("/occurrences?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z", {
      userId: member,
    });

    expect(response.status).toBe(200);
    const listed = (await response.json()) as { data: { recordingUrl: string | null }[] };
    expect(listed.data[0]?.recordingUrl).toBe("https://v.example.com/replay");
  });

  it("maps a hidden event to 404 in the error envelope", async () => {
    stub.getEvent.mockRejectedValue(new CalendarNotFoundError("event"));

    const response = await call("/events/secret", { userId: member });

    expect(response.status).toBe(404);
    expect(await error(response)).toMatchObject({ code: "not_found" });
  });

  it("routes a recording link in PATCH to setRecordingUrl only", async () => {
    stub.setRecordingUrl.mockResolvedValue({ ...event, recordingUrl: "https://v.example.com/1" });

    const response = await call("/events/weekly-call", {
      method: "PATCH",
      userId: member,
      body: { recordingUrl: "https://v.example.com/1" },
    });

    expect(response.status).toBe(200);
    expect(stub.updateEvent).not.toHaveBeenCalled();
    expect(stub.setRecordingUrl.mock.calls[0]?.[3]).toEqual({
      recordingUrl: "https://v.example.com/1",
    });
  });

  it("cancels and restores an occurrence and deletes an event", async () => {
    stub.cancelOccurrence.mockResolvedValue({ ...occurrence, canceledAt: at });
    stub.uncancelOccurrence.mockResolvedValue(occurrence);
    stub.deleteEvent.mockResolvedValue(undefined);

    const canceled = await call(`/occurrences/${occurrenceId}/cancel`, {
      method: "POST",
      userId: member,
    });
    const restored = await call(`/occurrences/${occurrenceId}/cancel`, {
      method: "DELETE",
      userId: member,
    });
    const deleted = await call("/events/weekly-call", { method: "DELETE", userId: member });

    expect(((await canceled.json()) as { canceledAt: string }).canceledAt).toBe(at.toISOString());
    expect(restored.status).toBe(200);
    expect(deleted.status).toBe(204);
  });

  it("records an RSVP and rejects an unknown status before the service", async () => {
    stub.rsvp.mockResolvedValue({ occurrenceId, status: "going", goingCount: 4 });

    const ok = await call(`/occurrences/${occurrenceId}/rsvp`, {
      method: "POST",
      userId: member,
      body: { status: "going" },
    });
    const bad = await call(`/occurrences/${occurrenceId}/rsvp`, {
      method: "POST",
      userId: member,
      body: { status: "maybe" },
    });

    expect(await ok.json()).toEqual({ occurrenceId, status: "going", goingCount: 4 });
    expect(bad.status).toBe(422);
    expect(stub.rsvp).toHaveBeenCalledTimes(1);
  });

  it("lists who is going with ISO dates and maps a member's denial to 403", async () => {
    stub.listOccurrenceRsvps.mockResolvedValue({
      occurrenceId,
      goingCount: 1,
      going: [{ userId: member, name: "Ada", username: "ada", image: null, respondedAt: at }],
    });

    const response = await call(`/occurrences/${occurrenceId}/rsvps`, { userId: member });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      occurrenceId,
      goingCount: 1,
      going: [
        {
          userId: member,
          name: "Ada",
          username: "ada",
          image: null,
          respondedAt: "2026-10-01T10:00:00.000Z",
        },
      ],
    });
    stub.listOccurrenceRsvps.mockRejectedValue(new ForbiddenError("read_rsvps", "event"));
    expect((await call(`/occurrences/${occurrenceId}/rsvps`, { userId: member })).status).toBe(403);
  });

  it("serves .ics files as text/calendar attachments", async () => {
    stub.icsForOccurrence.mockResolvedValue({
      filename: "weekly-call-2026-10-25.ics",
      content: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
    });
    stub.icsForEvent.mockResolvedValue({
      filename: "weekly-call.ics",
      content: "BEGIN:VCALENDAR\r\n",
    });

    const one = await call(`/occurrences/${occurrenceId}/ics`, { userId: member });
    const series = await call("/events/weekly-call/ics", { userId: member });

    expect(one.headers.get("content-type")).toContain("text/calendar");
    expect(one.headers.get("content-disposition")).toBe(
      'attachment; filename="weekly-call-2026-10-25.ics"',
    );
    expect(await one.text()).toContain("BEGIN:VCALENDAR");
    expect(series.status).toBe(200);
  });

  it("returns the viewer's upcoming occurrences", async () => {
    stub.getUpcomingForViewer.mockResolvedValue([occurrence]);

    const response = await call("/upcoming", { userId: member });

    expect(((await response.json()) as { data: unknown[] }).data).toHaveLength(1);
  });

  it("passes a signed out caller to the service as a guest and maps its 404", async () => {
    stub.getUpcomingForViewer.mockRejectedValue(new CalendarNotFoundError("community"));

    const response = await call("/upcoming");

    expect(response.status).toBe(404);
    expect(stub.getUpcomingForViewer.mock.calls[0]?.[0]).toEqual({ kind: "guest" });
  });
});

describe("calendar OpenAPI", () => {
  const document = createOpenApiDocument(api);

  it.each([
    ["/api/v1/communities/{slug}/calendar/occurrences", "get", "listCalendarOccurrences"],
    ["/api/v1/communities/{slug}/calendar/upcoming", "get", "listMyUpcomingOccurrences"],
    ["/api/v1/communities/{slug}/calendar/events", "post", "createCalendarEvent"],
    ["/api/v1/communities/{slug}/calendar/events/{eventSlug}", "get", "getCalendarEvent"],
    ["/api/v1/communities/{slug}/calendar/events/{eventSlug}", "patch", "updateCalendarEvent"],
    ["/api/v1/communities/{slug}/calendar/events/{eventSlug}", "delete", "deleteCalendarEvent"],
    [
      "/api/v1/communities/{slug}/calendar/events/{eventSlug}/ics",
      "get",
      "downloadCalendarEventIcs",
    ],
    [
      "/api/v1/communities/{slug}/calendar/events/{eventSlug}/occurrences/{occurrenceId}",
      "get",
      "getCalendarOccurrence",
    ],
    [
      "/api/v1/communities/{slug}/calendar/occurrences/{occurrenceId}/cancel",
      "post",
      "cancelCalendarOccurrence",
    ],
    [
      "/api/v1/communities/{slug}/calendar/occurrences/{occurrenceId}/cancel",
      "delete",
      "restoreCalendarOccurrence",
    ],
    [
      "/api/v1/communities/{slug}/calendar/occurrences/{occurrenceId}/rsvp",
      "post",
      "rsvpCalendarOccurrence",
    ],
    [
      "/api/v1/communities/{slug}/calendar/occurrences/{occurrenceId}/ics",
      "get",
      "downloadCalendarOccurrenceIcs",
    ],
  ] as const)("documents %s %s as %s", (path, method, operationId) => {
    const operation = document.paths?.[path]?.[method];

    expect(operation?.operationId).toBe(operationId);
    expect(operation?.security).toEqual([{ sessionCookie: [] }]);
    expect(Object.keys(operation?.responses ?? {})).toEqual(
      expect.arrayContaining(["401", "403", "404", "422"]),
    );
  });
});
