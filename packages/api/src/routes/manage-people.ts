import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Actor } from "@cohory/authz";
import type { ManageService } from "@cohory/communities";
import type { Context } from "hono";

import type { ActorVariables } from "../middleware/session";
import { pageCursor } from "../pagination";
import { routeMeta } from "../route-meta";
import {
  conflict,
  errors,
  jsonBody,
  jsonLimit,
  managers,
  manageBase as base,
  ownerOnly,
  security,
  staff,
  tags,
} from "./manage-common";
import {
  changeRoleBodySchema,
  createInviteBodySchema,
  exportMembersQuerySchema,
  inviteJson,
  inviteParams,
  inviteSchema,
  manageMemberJson,
  manageMemberSchema,
  memberChangeSchema,
  peopleQuerySchema,
  personParams,
  redeemedInviteSchema,
  redeemedJson,
  tokenParams,
} from "./manage-schemas";
import { errorResponse, json, page, slugParams, tooManyRequests } from "./posts-schemas";

const listPeople = createRoute({
  method: "get",
  path: `${base}/people`,
  operationId: "listManagePeople",
  "x-cohory": routeMeta("listManagePeople"),
  tags,
  security,
  summary: "List people for management",
  description: `Members newest first with role, status, level, points, and last active time. Filters by name or username prefix, role, status (default active), and inactiveDays (active members with no activity in that many days; counts posts, comments, likes, lesson views, RSVPs, and sign ins). Email is included for admins and owners only.${staff}`,
  request: { params: slugParams, query: peopleQuerySchema },
  responses: {
    200: json(page(manageMemberSchema, "ManageMemberPage"), "A page of people."),
    ...errors,
  },
});

const changeRole = createRoute({
  method: "patch",
  path: `${base}/people/{userId}/role`,
  operationId: "changeMemberRole",
  "x-cohory": routeMeta("changeMemberRole"),
  tags,
  security,
  summary: "Change a member's role",
  description:
    "The owner can set admin, moderator, or member. Admins can set moderator or member on members and moderators. Nobody can change the owner here; use the ownership transfer.",
  middleware: [jsonLimit] as const,
  request: { params: personParams, ...jsonBody(changeRoleBodySchema) },
  responses: { 200: json(memberChangeSchema, "The new role."), ...errors },
});

function personAction(action: "remove" | "ban" | "unban") {
  const descriptions = {
    remove:
      "Marks the membership removed. The person can rejoin later. The owner cannot be removed. A paying member's subscription is cancelled now, without proration and without a refund, by a background job that retries until Stripe confirms.",
    ban: "Marks the membership banned and records the email, so the same account or email cannot rejoin. A paying member's subscription is cancelled now, without proration and without a refund, by a background job that retries until Stripe confirms.",
    unban: "Lifts a ban. The membership becomes removed, so the person can join again.",
  } as const;
  return createRoute({
    method: "post",
    path: `${base}/people/{userId}/${action}`,
    operationId: `${action}Member`,
    "x-cohory": routeMeta(`${action}Member`),
    tags,
    security,
    summary: `${action[0]?.toUpperCase()}${action.slice(1)} a member`,
    description: `${descriptions[action]} Moderators act on members, admins on members and moderators, and the owner on anyone but themselves.`,
    middleware: [jsonLimit] as const,
    request: { params: personParams },
    responses: { 200: json(memberChangeSchema, "The membership after the change."), ...errors },
  });
}

const listInvites = createRoute({
  method: "get",
  path: `${base}/invites`,
  operationId: "listInviteLinks",
  "x-cohory": routeMeta("listInviteLinks"),
  tags,
  security,
  summary: "List invite links",
  description: `All invite links of the community, newest first, including revoked and expired ones.${managers}`,
  request: { params: slugParams },
  responses: {
    200: json(z.object({ data: z.array(inviteSchema), ...pageCursor }), "The invite links."),
    ...errors,
  },
});

const createInvite = createRoute({
  method: "post",
  path: `${base}/invites`,
  operationId: "createInviteLink",
  "x-cohory": routeMeta("createInviteLink"),
  tags,
  security,
  summary: "Create an invite link",
  description: `Creates a link at \`/join/{token}\` that lets a signed in person join, also a private community. Optional expiry and use limit.${managers}`,
  middleware: [jsonLimit] as const,
  request: { params: slugParams, ...jsonBody(createInviteBodySchema) },
  responses: {
    201: json(inviteSchema, "The new invite link."),
    409: conflict,
    429: tooManyRequests,
    ...errors,
  },
});

const revokeInvite = createRoute({
  method: "delete",
  path: `${base}/invites/{inviteId}`,
  operationId: "revokeInviteLink",
  "x-cohory": routeMeta("revokeInviteLink"),
  tags,
  security,
  summary: "Revoke an invite link",
  description: `The link stops working immediately. Revoking twice is harmless.${managers}`,
  middleware: [jsonLimit] as const,
  request: { params: inviteParams },
  responses: { 200: json(inviteSchema, "The revoked invite link."), ...errors },
});

const exportMembers = createRoute({
  method: "get",
  path: `${base}/export/members.csv`,
  operationId: "exportMembersCsv",
  "x-cohory": routeMeta("exportMembersCsv"),
  tags,
  security,
  summary: "Export members as CSV",
  description: `UTF-8 CSV with a byte order mark and RFC 4180 quoting. Columns: email, name, username, role, joined_at, level, points, status, stripe_customer_id, stripe_subscription_id (empty until payments exist), last_active_at, access (paying_monthly, paying_yearly, free_access, past_due, cancelling, or none; empty for callers who cannot read payments), signed_in (yes or no). Accepts the same filters as the people list; without filters every member of every status is exported. Fields that start with a spreadsheet formula character are prefixed with an apostrophe. Every export is written to the audit log with its filters.${ownerOnly}`,
  request: { params: slugParams, query: exportMembersQuerySchema },
  responses: {
    200: {
      description: "The CSV file.",
      content: { "text/csv": { schema: z.string().openapi({ format: "binary" }) } },
    },
    ...errors,
  },
});

const redeemInvite = createRoute({
  method: "post",
  path: "/invites/{token}/redeem",
  operationId: "redeemInvite",
  "x-cohory": routeMeta("redeemInvite"),
  tags: ["Communities"],
  security,
  summary: "Join with an invite link",
  description:
    "Joins the community of the invite link as a member. Calling it again as an active member changes nothing and uses no invite.",
  middleware: [jsonLimit] as const,
  request: { params: tokenParams },
  responses: {
    200: json(redeemedInviteSchema, "The community and membership."),
    401: errors[401],
    403: errorResponse("The caller is banned from the community."),
    409: errorResponse("The community is archived."),
    410: errorResponse("The invite link is expired, revoked, used up, or unknown."),
    429: tooManyRequests,
  },
});

export type InviteRateLimit = (
  c: Context<{ Variables: ActorVariables }>,
  rule: "inviteCreate" | "inviteRedeem",
) => void;

export function addPeopleRoutes(
  routes: OpenAPIHono<{ Variables: ActorVariables }>,
  manage: () => ManageService,
  communityId: (caller: Actor, slug: string) => Promise<string>,
  limit: InviteRateLimit,
): void {
  routes
    .openapi(listPeople, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const result = await manage().listMembersForManage(caller, id, c.req.valid("query"));
      return c.json(
        { data: result.data.map(manageMemberJson), nextCursor: result.nextCursor },
        200,
      );
    })
    .openapi(changeRole, async (c) => {
      const caller = c.get("actor");
      const { slug, userId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(await manage().changeRole(caller, id, userId, c.req.valid("json").role), 200);
    });

  const personActions = {
    remove: (caller: Actor, id: string, userId: string) =>
      manage().removeMember(caller, id, userId),
    ban: (caller: Actor, id: string, userId: string) => manage().banMember(caller, id, userId),
    unban: (caller: Actor, id: string, userId: string) => manage().unbanMember(caller, id, userId),
  } as const;
  for (const action of ["remove", "ban", "unban"] as const) {
    routes.openapi(personAction(action), async (c) => {
      const caller = c.get("actor");
      const { slug, userId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(await personActions[action](caller, id, userId), 200);
    });
  }

  routes
    .openapi(listInvites, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const invites = await manage().listInviteLinks(caller, id);
      return c.json({ data: invites.map(inviteJson), nextCursor: null }, 200);
    })
    .openapi(createInvite, async (c) => {
      limit(c, "inviteCreate");
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const body = c.req.valid("json");
      const invite = await manage().createInviteLink(caller, id, {
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        maxUses: body.maxUses ?? null,
        requiresApproval: body.requiresApproval ?? false,
      });
      return c.json(inviteJson(invite), 201);
    })
    .openapi(revokeInvite, async (c) => {
      const caller = c.get("actor");
      const { slug, inviteId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(inviteJson(await manage().revokeInviteLink(caller, id, inviteId)), 200);
    })
    .openapi(exportMembers, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const { filename, body } = await manage().exportMembersCsv(caller, id, c.req.valid("query"));
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    });
}

export function addRedeemInviteRoute(
  routes: OpenAPIHono<{ Variables: ActorVariables }>,
  manage: () => ManageService,
  limit: InviteRateLimit,
): void {
  routes.openapi(redeemInvite, async (c) => {
    limit(c, "inviteRedeem");
    const result = await manage().redeemInvite(c.get("actor"), c.req.valid("param").token);
    return c.json(redeemedJson(result), 200);
  });
}
