import { createRoute, z } from "@hono/zod-openapi";
import { assertCan, UnauthenticatedError, type ActionOf, type Actor } from "@cohory/authz";
import {
  inAppNotificationTypes,
  maxMarkReadIds,
  maxNotificationsPageSize,
  type NotificationView,
  type NotificationsService,
} from "@cohory/notifications";
import { bodyLimit } from "hono/body-limit";

import { cursorPage, cursorQuery } from "../pagination";
import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { resolveActor, type SessionResolver } from "../middleware/session";
import { errorResponse, json } from "./posts-schemas";

const writeLimit = bodyLimit({ maxSize: 64 * 1024 });

export interface NotificationsRouteDeps {
  resolveSession: SessionResolver;
  notifications: NotificationsService;
}

const isoDate = z.iso.datetime().openapi({ description: "ISO 8601 UTC timestamp." });

export const notificationSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(inAppNotificationTypes),
    community: z.object({ id: z.uuid(), slug: z.string(), name: z.string() }),
    actor: z.object({ id: z.uuid(), name: z.string(), image: z.string().nullable() }),
    subjectType: z.enum([
      "post",
      "comment",
      "membership_request",
      "approval_request",
      "course_delegation",
      "review",
      "community",
      "report",
      "event",
      "api_token",
      "agent_token",
    ]),
    subjectId: z.uuid(),
    postId: z
      .uuid()
      .nullable()
      .openapi({ description: "The post the notification is about, if any." }),
    href: z.string().openapi({
      description: "The app path to open when the notification is clicked.",
      example: "/c/makers/posts/0192f2a4-0000-7000-8000-000000000001",
    }),
    text: z.string().openapi({
      description: 'Plain text rendered by the server, for example "Ada mentioned you in a post".',
    }),
    preview: z.string().nullable().openapi({
      description:
        "The first line of the comment or post for mentions, replies, and comments. Null for other types and after the content was deleted.",
      example: "Love the glaze on this one",
    }),
    readAt: isoDate.nullable(),
    createdAt: isoDate,
  })
  .openapi("Notification");

const notificationPageSchema = cursorPage(notificationSchema).openapi("NotificationPage");

const unreadCountSchema = z
  .object({ unreadCount: z.int().nonnegative() })
  .openapi("NotificationUnreadCount");

const listQuerySchema = z.object({
  ...cursorQuery({ max: maxNotificationsPageSize, example: 20 }),
});

const markReadBodySchema = z
  .object({ ids: z.array(z.uuid()).min(1).max(maxMarkReadIds) })
  .openapi("MarkNotificationsRead");

const security = [{ sessionCookie: [] }];
const unauthenticated = errorResponse("Sign in required.");
const invalid = errorResponse("The input is invalid.");
const unreadResponse = json(unreadCountSchema, "The caller's unread count after the change.");

const listNotifications = createRoute({
  method: "get",
  path: "/notifications",
  operationId: "listNotifications",
  "x-cohory": routeMeta("listNotifications"),
  tags: ["Notifications"],
  summary: "List the caller's notifications",
  description: `The caller's notifications across every community the caller is an active member of, newest first: mentions, replies, comments, likes (grouped per post or comment), new members and reports for the people who run the community, money events for the owner, and event notices. Cursor pagination with \`cursor\` and \`limit\` (default 20, max ${maxNotificationsPageSize}).`,
  security,
  request: { query: listQuerySchema },
  responses: {
    200: json(notificationPageSchema, "A page of notifications."),
    401: unauthenticated,
    422: invalid,
  },
});

const getUnreadCount = createRoute({
  method: "get",
  path: "/notifications/unread-count",
  operationId: "getNotificationUnreadCount",
  "x-cohory": routeMeta("getNotificationUnreadCount"),
  tags: ["Notifications"],
  summary: "Count the caller's unread notifications",
  security,
  responses: { 200: json(unreadCountSchema, "The unread count."), 401: unauthenticated },
});

const markRead = createRoute({
  method: "post",
  path: "/notifications/read",
  operationId: "markNotificationsRead",
  "x-cohory": routeMeta("markNotificationsRead"),
  tags: ["Notifications"],
  summary: "Mark notifications read",
  description: `Idempotent. Ids that are already read or belong to someone else change nothing. Up to ${maxMarkReadIds} ids per call.`,
  security,
  middleware: [writeLimit] as const,
  request: {
    body: { required: true, content: { "application/json": { schema: markReadBodySchema } } },
  },
  responses: { 200: unreadResponse, 401: unauthenticated, 422: invalid },
});

const markAllRead = createRoute({
  method: "post",
  path: "/notifications/read-all",
  operationId: "markAllNotificationsRead",
  "x-cohory": routeMeta("markAllNotificationsRead"),
  tags: ["Notifications"],
  summary: "Mark all notifications read",
  description: "Idempotent.",
  security,
  middleware: [writeLimit] as const,
  responses: { 200: unreadResponse, 401: unauthenticated },
});

export function notificationJson(view: NotificationView): z.infer<typeof notificationSchema> {
  return {
    ...view,
    readAt: view.readAt ? view.readAt.toISOString() : null,
    createdAt: view.createdAt.toISOString(),
  };
}

function authorize(actor: Actor, action: ActionOf<"notification">): Actor {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  assertCan(actor, action, "notification");
  return actor;
}

export function createNotificationsRoutes(getDeps: () => NotificationsRouteDeps) {
  const app = createRouter();
  const service = () => getDeps().notifications;
  const actor = resolveActor(() => getDeps().resolveSession);
  app.use("/notifications", actor);
  app.use("/notifications/*", actor);

  return app
    .openapi(listNotifications, async (c) => {
      const actor = authorize(c.get("actor"), "read");
      const page = await service().listNotifications(actor, c.req.valid("query"));
      return c.json({ data: page.data.map(notificationJson), nextCursor: page.nextCursor }, 200);
    })
    .openapi(getUnreadCount, async (c) => {
      const actor = authorize(c.get("actor"), "read");
      return c.json({ unreadCount: await service().unreadCount(actor) }, 200);
    })
    .openapi(markRead, async (c) => {
      const actor = authorize(c.get("actor"), "mark_read");
      return c.json(await service().markRead(actor, c.req.valid("json")), 200);
    })
    .openapi(markAllRead, async (c) => {
      const actor = authorize(c.get("actor"), "mark_read");
      return c.json(await service().markAllRead(actor), 200);
    });
}
