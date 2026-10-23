import { createRoute, z } from "@hono/zod-openapi";
import type { Actor } from "@cohory/authz";
import { type CalendarService, type IcsFile } from "@cohory/calendar";
import type { CommunitiesService } from "@cohory/communities";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";

import { pageCursor } from "../pagination";
import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { resolveActor, type SessionResolver } from "../middleware/session";
import {
  createEventBodySchema,
  eventJson,
  eventOccurrenceParams,
  eventParams,
  eventDetailSchema,
  eventWithOccurrencesJson,
  eventWithOccurrencesSchema,
  occurrenceDetailJson,
  occurrenceDetailSchema,
  occurrenceJson,
  occurrenceParams,
  occurrenceRsvpsSchema,
  occurrenceSchema,
  rangeQuerySchema,
  rsvpBodySchema,
  rsvpResultSchema,
  updateEventBodySchema,
} from "./calendar-schemas";
import { archived, errorResponse, json, slugParams, tooManyRequests } from "./posts-schemas";

const writeLimit = bodyLimit({ maxSize: 64 * 1024 });

export interface CalendarRouteDeps {
  resolveSession: SessionResolver;
  communities: CommunitiesService;
  calendar: CalendarService;
}

const security = [{ sessionCookie: [] }];
const tags = ["Calendar"];
const errors = {
  401: errorResponse("Sign in required."),
  403: errorResponse("The caller is not allowed to do this in the community."),
  404: errorResponse("The community, event, or occurrence does not exist or is not visible."),
  422: errorResponse("The input is invalid."),
};
const managers = " Admins and owners only.";
const base = "/communities/{slug}/calendar";

function jsonBody<T extends z.ZodType>(schema: T) {
  return { body: { required: true, content: { "application/json": { schema } } } };
}

const icsResponse = {
  description: "An iCalendar file (RFC 5545).",
  content: { "text/calendar": { schema: z.string() } },
};

const listOccurrences = createRoute({
  method: "get",
  path: `${base}/occurrences`,
  operationId: "listCalendarOccurrences",
  "x-cohory": routeMeta("listCalendarOccurrences"),
  tags,
  security,
  summary: "List occurrences in a time range",
  description:
    "Occurrences that overlap the range, in UTC, with the event summary, the caller's RSVP, and the going count. Canceled occurrences stay in the list with canceledAt set; they leave the caller's upcoming list.",
  request: { params: slugParams, query: rangeQuerySchema },
  responses: {
    200: json(
      z
        .object({ data: z.array(occurrenceSchema), ...pageCursor })
        .openapi("CalendarOccurrenceList"),
      "Occurrences.",
    ),
    ...errors,
  },
});

const upcoming = createRoute({
  method: "get",
  path: `${base}/upcoming`,
  operationId: "listMyUpcomingOccurrences",
  "x-cohory": routeMeta("listMyUpcomingOccurrences"),
  tags,
  security,
  summary: "List the caller's next occurrences",
  description: "The next three occurrences the caller said they are going to.",
  request: { params: slugParams },
  responses: {
    200: json(
      z.object({ data: z.array(occurrenceSchema), ...pageCursor }).openapi("CalendarUpcomingList"),
      "Occurrences.",
    ),
    ...errors,
  },
});

const createEvent = createRoute({
  method: "post",
  path: `${base}/events`,
  operationId: "createCalendarEvent",
  "x-cohory": routeMeta("createCalendarEvent"),
  tags,
  security,
  summary: "Create an event",
  description: `Creates a single event or a weekly series from a local start time and an IANA time zone. Occurrences are generated up to the end date or 26 weeks ahead.${managers}`,
  middleware: [writeLimit] as const,
  request: { params: slugParams, ...jsonBody(createEventBodySchema) },
  responses: { 201: json(eventDetailSchema, "The new event."), ...errors },
});

const getEvent = createRoute({
  method: "get",
  path: `${base}/events/{eventSlug}`,
  operationId: "getCalendarEvent",
  "x-cohory": routeMeta("getCalendarEvent"),
  tags,
  security,
  summary: "Get an event with its next occurrences",
  description: "Location and recording link are visible to members only.",
  request: { params: eventParams },
  responses: { 200: json(eventWithOccurrencesSchema, "The event."), ...errors },
});

const updateEvent = createRoute({
  method: "patch",
  path: `${base}/events/{eventSlug}`,
  operationId: "updateCalendarEvent",
  "x-cohory": routeMeta("updateCalendarEvent"),
  tags,
  security,
  summary: "Edit a whole event or series",
  description: `Changes apply to the whole series. Future occurrences are regenerated; past ones and the RSVPs on unchanged occurrences stay.${managers}`,
  middleware: [writeLimit] as const,
  request: { params: eventParams, ...jsonBody(updateEventBodySchema) },
  responses: { 200: json(eventDetailSchema, "The updated event."), ...errors },
});

const deleteEvent = createRoute({
  method: "delete",
  path: `${base}/events/{eventSlug}`,
  operationId: "deleteCalendarEvent",
  "x-cohory": routeMeta("deleteCalendarEvent"),
  tags,
  security,
  summary: "Delete an event with all occurrences and RSVPs",
  description: managers.trim(),
  middleware: [writeLimit] as const,
  request: { params: eventParams },
  responses: { 204: { description: "The event is deleted." }, ...errors },
});

const eventIcs = createRoute({
  method: "get",
  path: `${base}/events/{eventSlug}/ics`,
  operationId: "downloadCalendarEventIcs",
  "x-cohory": routeMeta("downloadCalendarEventIcs"),
  tags,
  security,
  summary: "Download an event as .ics",
  description: "A weekly series has an RRULE and an EXDATE per canceled occurrence. Members only.",
  request: { params: eventParams },
  responses: { 200: icsResponse, ...errors },
});

const getOccurrence = createRoute({
  method: "get",
  path: `${base}/events/{eventSlug}/occurrences/{occurrenceId}`,
  operationId: "getCalendarOccurrence",
  "x-cohory": routeMeta("getCalendarOccurrence"),
  tags,
  security,
  summary: "Get one occurrence",
  description: "Location and recording link are visible to members only.",
  request: { params: eventOccurrenceParams },
  responses: { 200: json(occurrenceDetailSchema, "The occurrence."), ...errors },
});

const listRsvps = createRoute({
  method: "get",
  path: `${base}/occurrences/{occurrenceId}/rsvps`,
  operationId: "listCalendarOccurrenceRsvps",
  "x-cohory": routeMeta("listCalendarOccurrenceRsvps"),
  tags,
  security,
  summary: "List who is going",
  description: `The active members going to one occurrence, oldest answer first, up to 1,000.${managers}`,
  request: { params: occurrenceParams },
  responses: { 200: json(occurrenceRsvpsSchema, "Who is going."), ...errors },
});

function cancelRoute(method: "post" | "delete") {
  return createRoute({
    method,
    path: `${base}/occurrences/{occurrenceId}/cancel`,
    operationId: method === "post" ? "cancelCalendarOccurrence" : "restoreCalendarOccurrence",
    "x-cohory": routeMeta(
      method === "post" ? "cancelCalendarOccurrence" : "restoreCalendarOccurrence",
    ),
    tags,
    security,
    summary: method === "post" ? "Cancel one occurrence" : "Restore a canceled occurrence",
    description: `${method === "post" ? "Marks the occurrence canceled for everyone, keeps its RSVPs, and refuses new ones." : "Shows the occurrence again."}${managers}`,
    request: { params: occurrenceParams },
    responses: { 200: json(occurrenceSchema, "The occurrence."), ...errors },
  });
}

const cancelOccurrence = cancelRoute("post");
const restoreOccurrence = cancelRoute("delete");

const rsvp = createRoute({
  method: "post",
  path: `${base}/occurrences/{occurrenceId}/rsvp`,
  operationId: "rsvpCalendarOccurrence",
  "x-cohory": routeMeta("rsvpCalendarOccurrence"),
  tags,
  security,
  summary: "RSVP to an occurrence",
  description:
    "Going or not going. Repeating the same answer changes nothing. Rate limited per member (see docs/self-hosting.md).",
  middleware: [writeLimit] as const,
  request: { params: occurrenceParams, ...jsonBody(rsvpBodySchema) },
  responses: {
    200: json(rsvpResultSchema, "The caller's RSVP."),
    ...errors,
    409: archived,
    429: tooManyRequests,
  },
});

const occurrenceIcs = createRoute({
  method: "get",
  path: `${base}/occurrences/{occurrenceId}/ics`,
  operationId: "downloadCalendarOccurrenceIcs",
  "x-cohory": routeMeta("downloadCalendarOccurrenceIcs"),
  tags,
  security,
  summary: "Download one occurrence as .ics",
  description: "Members only.",
  request: { params: occurrenceParams },
  responses: { 200: icsResponse, ...errors },
});

function icsBody(c: Context, file: IcsFile): Response {
  return c.body(file.content, 200, {
    "content-type": "text/calendar; charset=utf-8",
    "content-disposition": `attachment; filename="${file.filename.replace(/[^a-z0-9.-]/gi, "-")}"`,
  });
}

export function createCalendarRoutes(getDeps: () => CalendarRouteDeps) {
  const app = createRouter();
  app.use(
    "/communities/:slug/calendar/*",
    resolveActor(() => getDeps().resolveSession),
  );

  const calendar = () => getDeps().calendar;

  async function communityId(caller: Actor, slug: string): Promise<string> {
    return (await getDeps().communities.getCommunityBySlug(caller, slug)).id;
  }

  return app
    .openapi(listOccurrences, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const { from, to } = c.req.valid("query");
      const list = await calendar().listOccurrences(caller, id, {
        from: new Date(from),
        to: new Date(to),
      });
      return c.json({ data: list.map(occurrenceJson), nextCursor: null }, 200);
    })
    .openapi(upcoming, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const list = await calendar().getUpcomingForViewer(caller, id);
      return c.json({ data: list.map(occurrenceJson), nextCursor: null }, 200);
    })
    .openapi(createEvent, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      return c.json(eventJson(await calendar().createEvent(caller, id, c.req.valid("json"))), 201);
    })
    .openapi(getEvent, async (c) => {
      const caller = c.get("actor");
      const { slug, eventSlug } = c.req.valid("param");
      const event = await calendar().getEvent(caller, await communityId(caller, slug), eventSlug);
      return c.json(eventWithOccurrencesJson(event), 200);
    })
    .openapi(updateEvent, async (c) => {
      const caller = c.get("actor");
      const { slug, eventSlug } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const { recordingUrl, ...changes } = c.req.valid("json");
      let event =
        Object.keys(changes).length > 0 || recordingUrl === undefined
          ? await calendar().updateEvent(caller, id, eventSlug, changes)
          : null;
      if (recordingUrl !== undefined) {
        event = await calendar().setRecordingUrl(caller, id, eventSlug, { recordingUrl });
      }
      if (!event) {
        throw new Error("update produced no event");
      }
      return c.json(eventJson(event), 200);
    })
    .openapi(deleteEvent, async (c) => {
      const caller = c.get("actor");
      const { slug, eventSlug } = c.req.valid("param");
      await calendar().deleteEvent(caller, await communityId(caller, slug), eventSlug);
      return c.body(null, 204);
    })
    .openapi(eventIcs, async (c) => {
      const caller = c.get("actor");
      const { slug, eventSlug } = c.req.valid("param");
      const file = await calendar().icsForEvent(caller, await communityId(caller, slug), eventSlug);
      return icsBody(c, file);
    })
    .openapi(getOccurrence, async (c) => {
      const caller = c.get("actor");
      const { slug, eventSlug, occurrenceId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const occurrence = await calendar().getOccurrence(caller, id, eventSlug, occurrenceId);
      return c.json(occurrenceDetailJson(occurrence), 200);
    })
    .openapi(listRsvps, async (c) => {
      const caller = c.get("actor");
      const { slug, occurrenceId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const list = await calendar().listOccurrenceRsvps(caller, id, occurrenceId);
      return c.json(
        {
          occurrenceId: list.occurrenceId,
          goingCount: list.goingCount,
          going: list.going.map((person) => ({
            ...person,
            respondedAt: person.respondedAt.toISOString(),
          })),
        },
        200,
      );
    })
    .openapi(cancelOccurrence, async (c) => {
      const caller = c.get("actor");
      const { slug, occurrenceId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(
        occurrenceJson(await calendar().cancelOccurrence(caller, id, occurrenceId)),
        200,
      );
    })
    .openapi(restoreOccurrence, async (c) => {
      const caller = c.get("actor");
      const { slug, occurrenceId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const occurrence = await calendar().uncancelOccurrence(caller, id, occurrenceId);
      return c.json(occurrenceJson(occurrence), 200);
    })
    .openapi(rsvp, async (c) => {
      const caller = c.get("actor");
      const { slug, occurrenceId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(await calendar().rsvp(caller, id, occurrenceId, c.req.valid("json")), 200);
    })
    .openapi(occurrenceIcs, async (c) => {
      const caller = c.get("actor");
      const { slug, occurrenceId } = c.req.valid("param");
      const file = await calendar().icsForOccurrence(
        caller,
        await communityId(caller, slug),
        occurrenceId,
      );
      return icsBody(c, file);
    });
}
