import { createRoute, z } from "@hono/zod-openapi";
import { assertCan, UnauthenticatedError, type Actor } from "@cohory/authz";
import {
  deliveredNotificationTypes,
  NotificationValidationError,
  notificationEmailModes,
  type NotificationPreferences,
  type PreferencesService,
} from "@cohory/notifications";
import { bodyLimit } from "hono/body-limit";

import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { resolveActor, type SessionResolver } from "../middleware/session";
import { errorResponse, json } from "./posts-schemas";

const writeLimit = bodyLimit({ maxSize: 16 * 1024 });

export interface NotificationPreferencesRouteDeps {
  resolveSession: SessionResolver;
  preferences: PreferencesService;
}

const typeSchema = z.enum(deliveredNotificationTypes);

const typePreferenceSchema = z
  .object({
    type: typeSchema,
    inApp: z.boolean().openapi({ description: "Show this type in the notifications bell." }),
    email: z.enum(notificationEmailModes).openapi({
      description:
        "immediate sends one email per notification, daily batches them into one summary at digestHour, off sends none.",
    }),
  })
  .openapi("NotificationTypePreference");

export const notificationPreferencesSchema = z
  .object({
    types: z.array(typePreferenceSchema),
    digestHour: z.int().min(0).max(23).openapi({
      description: "Local hour (0 to 23) in timeZone when the daily summary is sent.",
    }),
    timeZone: z.string().openapi({ description: "IANA time zone name.", example: "Europe/Berlin" }),
    weeklyDigest: z.boolean().openapi({
      description:
        "Send one weekly digest email on Monday at digestHour with the top posts, new members, and coming events of every community you belong to.",
    }),
  })
  .openapi("NotificationPreferences");

const updateBodySchema = z
  .object({
    types: z.array(typePreferenceSchema).max(deliveredNotificationTypes.length).optional(),
    digestHour: z.int().min(0).max(23).optional(),
    timeZone: z.string().max(64).optional(),
    weeklyDigest: z.boolean().optional(),
  })
  .openapi("UpdateNotificationPreferences");

const unsubscribeResultSchema = z
  .object({
    scope: z.enum([...deliveredNotificationTypes, "daily", "weekly"]),
    label: z.string().openapi({ description: 'Plain words for the scope, like "mentions".' }),
  })
  .openapi("NotificationUnsubscribeResult");

const security = [{ sessionCookie: [] }];
const unauthenticated = errorResponse("Sign in required.");
const invalid = errorResponse("The input is invalid.");

const getPreferences = createRoute({
  method: "get",
  path: "/notification-preferences",
  operationId: "getNotificationPreferences",
  "x-cohory": routeMeta("getNotificationPreferences"),
  tags: ["Notifications"],
  summary: "Read the caller's notification preferences",
  description:
    "Per notification type: whether it shows in the app and how it is emailed. Types without a saved choice return the defaults: mentions and replies email immediately, comments on your posts go into the daily summary, all show in the app, summary at 08:00.",
  security,
  responses: {
    200: json(notificationPreferencesSchema, "The caller's preferences."),
    401: unauthenticated,
  },
});

const updatePreferences = createRoute({
  method: "put",
  path: "/notification-preferences",
  operationId: "updateNotificationPreferences",
  "x-cohory": routeMeta("updateNotificationPreferences"),
  tags: ["Notifications"],
  summary: "Change the caller's notification preferences",
  description:
    "Saves only the fields sent. Each type may appear once. Changes apply to notifications created afterwards and to unsent ones.",
  security,
  middleware: [writeLimit] as const,
  request: {
    body: { required: true, content: { "application/json": { schema: updateBodySchema } } },
  },
  responses: {
    200: json(notificationPreferencesSchema, "The saved preferences."),
    401: unauthenticated,
    422: invalid,
  },
});

const unsubscribe = createRoute({
  method: "post",
  path: "/notification-preferences/unsubscribe",
  operationId: "unsubscribeFromNotificationEmail",
  "x-cohory": routeMeta("unsubscribeFromNotificationEmail"),
  tags: ["Notifications"],
  summary: "Turn off one kind of notification email with the link from an email",
  description:
    "One click unsubscribe (RFC 8058). Needs no session: the signed token from the email names the member and the notification type, daily for every type sent as a daily summary, or weekly for the weekly digest. Sets email to off for that scope. Repeating it changes nothing.",
  middleware: [bodyLimit({ maxSize: 1024 })] as const,
  request: {
    query: z.object({
      token: z
        .string()
        .min(1)
        .max(512)
        .openapi({ param: { name: "token", in: "query" } }),
    }),
  },
  responses: {
    200: json(unsubscribeResultSchema, "Email for that scope is now off."),
    422: invalid,
  },
});

function preferencesJson(
  view: NotificationPreferences,
): z.infer<typeof notificationPreferencesSchema> {
  return {
    types: [...view.types],
    digestHour: view.digestHour,
    timeZone: view.timeZone,
    weeklyDigest: view.weeklyDigest,
  };
}

function authorize(actor: Actor): Actor {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  assertCan(actor, "update_own", "account");
  return actor;
}

export function createNotificationPreferencesRoutes(
  getDeps: () => NotificationPreferencesRouteDeps,
) {
  const app = createRouter();
  const service = () => getDeps().preferences;
  const actor = resolveActor(() => getDeps().resolveSession);
  app.use("/notification-preferences", actor);

  return app
    .openapi(getPreferences, async (c) => {
      const caller = authorize(c.get("actor"));
      return c.json(preferencesJson(await service().getPreferences(caller)), 200);
    })
    .openapi(updatePreferences, async (c) => {
      const caller = authorize(c.get("actor"));
      const saved = await service().updatePreferences(caller, c.req.valid("json"));
      return c.json(preferencesJson(saved), 200);
    })
    .openapi(unsubscribe, async (c) => {
      const result = await service().unsubscribe(c.req.valid("query").token);
      if (!result) {
        throw new NotificationValidationError([
          { path: "token", message: "This unsubscribe link is not valid." },
        ]);
      }
      return c.json(result, 200);
    });
}
