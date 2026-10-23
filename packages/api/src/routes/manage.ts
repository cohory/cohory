import { createRoute } from "@hono/zod-openapi";
import type { Actor } from "@cohory/authz";
import {
  type BrandingKind,
  type CommunitiesService,
  type ManageService,
} from "@cohory/communities";
import { clientIp, type RateLimiter } from "@cohory/rate-limit";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  errors,
  jsonBody,
  jsonLimit,
  managers,
  manageBase as base,
  ownerOnly,
  security,
  tags,
} from "./manage-common";
import { addPeopleRoutes, addRedeemInviteRoute } from "./manage-people";

import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { resolveActor, type ActorVariables, type SessionResolver } from "../middleware/session";
import { addGalleryRoutes } from "./gallery";
import {
  appearanceJson,
  appearanceSchema,
  brandingUploadFormSchema,
  overviewSchema,
  settingsJson,
  settingsSchema,
  archiveBodySchema,
  deleteBodySchema,
  deletingSchema,
  transferBodySchema,
  updateAppearanceBodySchema,
  updateSettingsBodySchema,
  usageSchema,
} from "./manage-schemas";
import { errorResponse, json, slugParams } from "./posts-schemas";

export interface ManageRouteDeps {
  resolveSession: SessionResolver;
  communities: CommunitiesService;
  manage: ManageService;
  rateLimiter: RateLimiter;
}

const getOverview = createRoute({
  method: "get",
  path: `${base}/overview`,
  operationId: "getManageOverview",
  "x-cohory": routeMeta("getManageOverview"),
  tags,
  security,
  summary: "Get community stats",
  description: `Active members, members who joined in the last 7 days, posts and comments in the last 7 days, upcoming event occurrences, and published courses.${managers}`,
  request: { params: slugParams },
  responses: { 200: json(overviewSchema, "The stats."), ...errors },
});

const getUsage = createRoute({
  method: "get",
  path: `${base}/usage`,
  operationId: "getManageUsage",
  "x-cohory": routeMeta("getManageUsage"),
  tags,
  security,
  summary: "Get fair use usage",
  description: `Active members and stored file bytes against the community's fair use limits, and the largest single upload allowed. A null limit means no limit, which is the default on the Community Edition.${managers}`,
  request: { params: slugParams },
  responses: { 200: json(usageSchema, "Usage and limits."), ...errors },
});

const getSettings = createRoute({
  method: "get",
  path: `${base}/settings`,
  operationId: "getCommunitySettings",
  "x-cohory": routeMeta("getCommunitySettings"),
  tags,
  security,
  summary: "Get community settings",
  description: `Name, description, privacy, gamification switch, level names, and archive state.${managers}`,
  request: { params: slugParams },
  responses: { 200: json(settingsSchema, "The settings."), ...errors },
});

const updateSettings = createRoute({
  method: "patch",
  path: `${base}/settings`,
  operationId: "updateCommunitySettings",
  "x-cohory": routeMeta("updateCommunitySettings"),
  tags,
  security,
  summary: "Update community settings",
  description: `Changes only the fields sent. Every change is written to the audit log with before and after values.${managers}`,
  middleware: [jsonLimit] as const,
  request: { params: slugParams, ...jsonBody(updateSettingsBodySchema) },
  responses: { 200: json(settingsSchema, "The updated settings."), ...errors },
});

const updateAppearance = createRoute({
  method: "patch",
  path: `${base}/appearance`,
  operationId: "updateCommunityAppearance",
  "x-cohory": routeMeta("updateCommunityAppearance"),
  tags,
  security,
  summary: "Update community appearance",
  description: `Accent color, heading font, card style, default theme, and the detailed description of the About page. The server derives accessible accent tokens for both modes and stores them. The detailed description uses the post content format without images, mentions become plain text, and null removes it.${managers}`,
  middleware: [jsonLimit] as const,
  request: { params: slugParams, ...jsonBody(updateAppearanceBodySchema) },
  responses: { 200: json(appearanceSchema, "The saved appearance."), ...errors },
});

function brandingRoute(kind: BrandingKind) {
  const label = kind === "logo" ? "logo" : "cover image";
  return createRoute({
    method: "post",
    path: `${base}/appearance/${kind}`,
    operationId: kind === "logo" ? "uploadCommunityLogo" : "uploadCommunityCover",
    "x-cohory": routeMeta(kind === "logo" ? "uploadCommunityLogo" : "uploadCommunityCover"),
    tags,
    security,
    summary: `Upload the community ${label}`,
    description: `Accepts one PNG, JPEG, WebP, or GIF image in the \`file\` field, up to ${kind === "logo" ? 5 : 10} MB. Replaces the current ${label}.${managers}`,
    middleware: [bodyLimit({ maxSize: 10 * 1024 * 1024 + 64 * 1024 })] as const,
    request: {
      params: slugParams,
      body: {
        required: true,
        content: { "multipart/form-data": { schema: brandingUploadFormSchema } },
      },
    },
    responses: { 200: json(appearanceSchema, "The saved appearance."), ...errors },
  });
}

const transfer = createRoute({
  method: "post",
  path: `${base}/transfer`,
  operationId: "transferOwnership",
  "x-cohory": routeMeta("transferOwnership"),
  tags,
  security,
  summary: "Transfer ownership",
  description: `Makes an active member the owner. The current owner becomes an admin. Payment connections do not move.${ownerOnly}`,
  middleware: [jsonLimit] as const,
  request: { params: slugParams, ...jsonBody(transferBodySchema) },
  responses: { 200: json(settingsSchema, "The community settings."), ...errors },
});

const archiveCommunityRoute = createRoute({
  method: "post",
  path: `${base}/archive`,
  operationId: "archiveCommunity",
  "x-cohory": routeMeta("archiveCommunity"),
  tags,
  security,
  summary: "Archive the community",
  description: `New members cannot join, invite links stop working, and new paid memberships are closed while the community is archived. The body chooses what happens to paying members. Calling it again on an archived community applies a new choice.${ownerOnly}`,
  middleware: [jsonLimit] as const,
  request: { params: slugParams, ...jsonBody(archiveBodySchema, false) },
  responses: { 200: json(settingsSchema, "The community settings."), ...errors },
});

const unarchiveCommunityRoute = createRoute({
  method: "post",
  path: `${base}/unarchive`,
  operationId: "unarchiveCommunity",
  "x-cohory": routeMeta("unarchiveCommunity"),
  tags,
  security,
  summary: "Restore an archived community",
  description: `Lets people join again. Subscriptions already set to end stay that way.${ownerOnly}`,
  middleware: [jsonLimit] as const,
  request: { params: slugParams },
  responses: { 200: json(settingsSchema, "The community settings."), ...errors },
});

const deleteCommunity = createRoute({
  method: "delete",
  path: base,
  operationId: "deleteCommunity",
  "x-cohory": routeMeta("deleteCommunity"),
  tags,
  security,
  summary: "Delete the community",
  description: `Permanently deletes an archived community and everything in it. Archive it first, and export members before deleting. Cohory first cancels every paying member's subscription at once without proration; while that runs the answer is 202 and the community stays archived. Payment records and platform invoices are kept with the community name. Refused with 409 exit_in_progress while another change to paid members runs, deletion_blocked_billing while a Cohory invoice is unpaid, and manual_cancellation_required (details.count) when Stripe is disconnected and Cohory still counts paying members.${ownerOnly}`,
  middleware: [jsonLimit] as const,
  request: { params: slugParams, ...jsonBody(deleteBodySchema, false) },
  responses: {
    202: json(deletingSchema, "Subscriptions are being cancelled. The community is deleted after."),
    204: { description: "Deleted." },
    409: errorResponse(
      "The community is not archived, another change to paid members is running, a Cohory invoice is unpaid, or the owner must confirm cancelling subscriptions in Stripe.",
    ),
    ...errors,
  },
});

const getAppearance = createRoute({
  method: "get",
  path: "/communities/{slug}/appearance",
  operationId: "getCommunityAppearance",
  "x-cohory": routeMeta("getCommunityAppearance"),
  tags: ["Communities"],
  summary: "Get community appearance",
  description:
    "Public. The accent tokens, CSS variables for light and dark mode, font, card style, theme, logo, and cover, used to render the community shell for anyone, including signed out visitors.",
  request: { params: slugParams },
  responses: {
    200: json(appearanceSchema, "The appearance."),
    404: errorResponse("The community does not exist."),
  },
});
export function createManageRoutes(getDeps: () => ManageRouteDeps) {
  const app = createRouter();
  const actor = resolveActor(() => getDeps().resolveSession);
  app.use("/communities/:slug/manage", actor);
  app.use("/communities/:slug/manage/*", actor);
  app.use("/communities/:slug/appearance", actor);
  app.use("/invites/*", actor);

  const manage = () => getDeps().manage;
  const limit = (
    c: Context<{ Variables: ActorVariables }>,
    rule: "inviteCreate" | "inviteRedeem",
  ) => {
    const caller = c.get("actor");
    const key = caller.kind === "user" ? caller.userId : clientIp(c.req.raw.headers);
    getDeps().rateLimiter.consume(rule, key);
  };

  async function communityId(caller: Actor, slug: string): Promise<string> {
    return (await getDeps().communities.getCommunityBySlug(caller, slug)).id;
  }

  const routes = app
    .openapi(getOverview, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      return c.json(await manage().getOverviewStats(caller, id), 200);
    })
    .openapi(getUsage, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      return c.json(await manage().getUsage(caller, id), 200);
    })
    .openapi(getSettings, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      return c.json(settingsJson(await manage().getSettings(caller, id)), 200);
    })
    .openapi(updateSettings, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      return c.json(
        settingsJson(await manage().updateSettings(caller, id, c.req.valid("json"))),
        200,
      );
    })
    .openapi(updateAppearance, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const view = await manage().updateAppearance(caller, id, c.req.valid("json"));
      return c.json(appearanceJson(view), 200);
    });

  for (const kind of ["logo", "cover"] as const) {
    routes.openapi(brandingRoute(kind), async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const { file } = c.req.valid("form");
      const view = await manage().uploadBranding(caller, id, kind, {
        bytes: new Uint8Array(await file.arrayBuffer()),
        declaredType: file.type,
      });
      return c.json(appearanceJson(view), 200);
    });
  }

  addGalleryRoutes(routes, manage, communityId);

  addPeopleRoutes(routes, manage, communityId, limit);

  routes
    .openapi(transfer, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const view = await manage().transferOwnership(caller, id, c.req.valid("json").userId);
      return c.json(settingsJson(view), 200);
    })
    .openapi(archiveCommunityRoute, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const body = c.req.valid("json");
      const view = await manage().archiveCommunity(caller, id, {
        ...(body?.paidMembers ? { paidMembers: body.paidMembers } : {}),
        ...(body?.includeLinked === undefined ? {} : { includeLinked: body.includeLinked }),
      });
      return c.json(settingsJson(view), 200);
    })
    .openapi(unarchiveCommunityRoute, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      return c.json(settingsJson(await manage().unarchiveCommunity(caller, id)), 200);
    })
    .openapi(deleteCommunity, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const body = c.req.valid("json");
      const outcome = await manage().deleteCommunity(caller, id, {
        ...(body?.includeLinked === undefined ? {} : { includeLinked: body.includeLinked }),
        ...(body?.confirmedManualCancellation === undefined
          ? {}
          : { confirmedManualCancellation: body.confirmedManualCancellation }),
      });
      if (outcome.kind === "deleting") {
        return c.json({ status: "deleting" as const }, 202);
      }
      return c.body(null, 204);
    })
    .openapi(getAppearance, async (c) => {
      const id = await communityId(c.get("actor"), c.req.valid("param").slug);
      return c.json(appearanceJson(await manage().getAppearance(id)), 200);
    });
  addRedeemInviteRoute(routes, manage, limit);

  return app;
}
