import { createRoute, z } from "@hono/zod-openapi";
import { compNoteMaxLength } from "@cohory/db/schema";
import {
  type CompInvitationListItem,
  type CompInvitationView,
  type CompListItem,
  type CompView,
  type MyCompInvitations,
} from "@cohory/payments";
import { bodyLimit } from "hono/body-limit";

import { pageCursor } from "../pagination";
import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { resolveActor } from "../middleware/session";
import type { PaymentsRouteDeps } from "./payments";
import { communityIdParams } from "./payments-schemas";
import { errorResponse, json } from "./posts-schemas";

const writeLimit = bodyLimit({ maxSize: 16 * 1024 });

const security = [{ sessionCookie: [] }];
const tags = ["Payments"];
const base = "/communities/{communityId}/payments/comps";
const errors = {
  401: errorResponse("Sign in required."),
  403: errorResponse("The caller is not allowed to do this, or the person is banned."),
  404: errorResponse("The community, person, or comped access does not exist."),
  409: errorResponse("The person already has comped access, or the community sells no plan."),
  422: errorResponse("The input is invalid."),
};
const managers = " Admins and owners only.";

const compStatus = z.enum(["active", "expired", "revoked"]);

const compSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    note: z.string().nullable(),
    expiresAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    status: compStatus,
  })
  .openapi("Comp");

const compListSchema = z
  .object({
    data: z.array(
      compSchema.extend({
        userName: z.string(),
        userEmail: z.string(),
        grantedByName: z.string().nullable(),
      }),
    ),
    ...pageCursor,
  })
  .openapi("CompList");

const compInvitationSchema = z
  .object({
    id: z.uuid(),
    email: z.string(),
    note: z.string().nullable(),
    expiresAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi("CompInvitation");

const compInvitationListSchema = z
  .object({
    data: z.array(compInvitationSchema.extend({ grantedByName: z.string().nullable() })),
    ...pageCursor,
  })
  .openapi("CompInvitationList");

const compOfferListSchema = z
  .object({
    data: z.array(
      z.object({
        id: z.uuid(),
        expiresAt: z.iso.datetime().nullable().openapi({
          description: "When the free access would end, or null for no end date.",
        }),
      }),
    ),
    ...pageCursor,
    waitingForVerification: z.boolean().openapi({
      description:
        "True when an offer waits for this address but the caller has not confirmed their email yet.",
    }),
  })
  .openapi("CompOfferList");

const grantBodySchema = z
  .object({
    email: z.email().max(254).optional().openapi({ description: "Find the person by email." }),
    userId: z.uuid().optional().openapi({ description: "Or pass the person's user id." }),
    expiresAt: z.iso.datetime({ offset: true }).nullable().optional().openapi({
      description: "When the free access ends. Leave out or null for no end date.",
    }),
    note: z.string().max(compNoteMaxLength).optional(),
  })
  .openapi("GrantCompInput");

const compParams = communityIdParams.extend({
  compId: z.uuid().openapi({ param: { name: "compId", in: "path" } }),
});

const invitationParams = communityIdParams.extend({
  invitationId: z.uuid().openapi({ param: { name: "invitationId", in: "path" } }),
});

function compOfferListJson(offers: MyCompInvitations): z.infer<typeof compOfferListSchema> {
  return {
    data: offers.invitations.map((offer) => ({
      id: offer.id,
      expiresAt: offer.expiresAt?.toISOString() ?? null,
    })),
    nextCursor: null,
    waitingForVerification: offers.waitingForVerification,
  };
}

function compInvitationJson(invitation: CompInvitationView): z.infer<typeof compInvitationSchema> {
  return {
    id: invitation.id,
    email: invitation.email,
    note: invitation.note,
    expiresAt: invitation.expiresAt?.toISOString() ?? null,
    createdAt: invitation.createdAt.toISOString(),
  };
}

function compInvitationListJson(
  items: readonly CompInvitationListItem[],
): z.infer<typeof compInvitationListSchema> {
  return {
    data: items.map((item) => ({
      ...compInvitationJson(item),
      grantedByName: item.grantedByName,
    })),
    nextCursor: null,
  };
}

function compJson(comp: CompView): z.infer<typeof compSchema> {
  return {
    id: comp.id,
    userId: comp.userId,
    note: comp.note,
    expiresAt: comp.expiresAt?.toISOString() ?? null,
    createdAt: comp.createdAt.toISOString(),
    status: comp.status,
  };
}

function compListJson(items: readonly CompListItem[]): z.infer<typeof compListSchema> {
  return {
    data: items.map((item) => ({
      ...compJson(item),
      userName: item.userName,
      userEmail: item.userEmail,
      grantedByName: item.grantedByName,
    })),
    nextCursor: null,
  };
}

const listComps = createRoute({
  method: "get",
  path: base,
  operationId: "listComps",
  "x-cohory": routeMeta("listComps"),
  tags,
  security,
  summary: "List comped access",
  description: `People with free access to the paid community that has not ended, newest first.${managers}`,
  request: { params: communityIdParams },
  responses: { 200: json(compListSchema, "Comped access."), ...errors },
});

const grantComp = createRoute({
  method: "post",
  path: base,
  operationId: "grantComp",
  "x-cohory": routeMeta("grantComp"),
  tags,
  security,
  summary: "Grant comped access",
  description: `Gives a person free access to a paid community, by email or user id, with an optional end date. Access works like an active subscription, the person becomes a member, and the grant is written to the audit log. An hourly job ends expired grants. On the Cloud Edition a user id must belong to a member of the community (active, or who left on their own), and an email always records an invitation (202) that the person accepts on their membership page after signing in with that confirmed address; the answer is the same whether or not the address has an account. This route does not email the person: tell them yourself.${managers}`,
  middleware: [writeLimit] as const,
  request: {
    params: communityIdParams,
    body: { required: true, content: { "application/json": { schema: grantBodySchema } } },
  },
  responses: {
    201: json(compSchema, "The comped access."),
    202: json(compInvitationSchema, "The invitation, on the Cloud Edition when granted by email."),
    ...errors,
  },
});

const listCompInvitations = createRoute({
  method: "get",
  path: `${base}/invitations`,
  operationId: "listCompInvitations",
  "x-cohory": routeMeta("listCompInvitations"),
  tags,
  security,
  summary: "List pending comped access invitations",
  description: `Invitations to free access that nobody has accepted or withdrawn yet, newest first.${managers}`,
  request: { params: communityIdParams },
  responses: { 200: json(compInvitationListSchema, "Pending invitations."), ...errors },
});

const withdrawCompInvitation = createRoute({
  method: "delete",
  path: `${base}/invitations/{invitationId}`,
  operationId: "withdrawCompInvitation",
  "x-cohory": routeMeta("withdrawCompInvitation"),
  tags,
  security,
  summary: "Withdraw a comped access invitation",
  description: `Withdraws a pending invitation so it can no longer be accepted.${managers}`,
  middleware: [writeLimit] as const,
  request: { params: invitationParams },
  responses: { 200: json(compInvitationSchema, "The withdrawn invitation."), ...errors },
});

const offerErrors = {
  401: errorResponse("Sign in required."),
  403: errorResponse("The caller is banned from the community, or used an API token."),
  404: errorResponse(
    "The community or the offer does not exist, or the offer is not for the caller.",
  ),
  409: errorResponse("The caller already has comped access, or the community sells no plan."),
  422: errorResponse("The input is invalid."),
};
const ownOffers =
  " Only the signed in person whose confirmed email the offer was sent to sees and accepts it. API tokens and agents cannot list or accept offers.";

const listMyCompOffers = createRoute({
  method: "get",
  path: `${base}/offers`,
  operationId: "listMyCompOffers",
  "x-cohory": routeMeta("listMyCompOffers"),
  tags,
  security,
  summary: "List my comped access offers",
  description: `Free access offers waiting for the caller in this community. On the Cloud Edition a grant by email becomes an offer; the Community Edition grants at once and this list stays empty.${ownOffers}`,
  request: { params: communityIdParams },
  responses: { 200: json(compOfferListSchema, "The caller's pending offers."), ...offerErrors },
});

const acceptCompOffer = createRoute({
  method: "post",
  path: `${base}/offers/{invitationId}/accept`,
  operationId: "acceptCompOffer",
  "x-cohory": routeMeta("acceptCompOffer"),
  tags,
  security,
  summary: "Accept a comped access offer",
  description: `Accepts a free access offer, the same as "Accept free access" on the membership page: the comp is written to the audit log and the caller becomes a member.${ownOffers}`,
  middleware: [writeLimit] as const,
  request: { params: invitationParams },
  responses: { 200: json(compSchema, "The comped access."), ...offerErrors },
});

const revokeComp = createRoute({
  method: "delete",
  path: `${base}/{compId}`,
  operationId: "revokeComp",
  "x-cohory": routeMeta("revokeComp"),
  tags,
  security,
  summary: "Revoke comped access",
  description: `Ends the free access now. The membership is removed unless the person has a paying subscription or a staff role.${managers}`,
  middleware: [writeLimit] as const,
  request: { params: compParams },
  responses: { 200: json(compSchema, "The ended comped access."), ...errors },
});

export function createCompsRoutes(getDeps: () => PaymentsRouteDeps) {
  const app = createRouter();
  const actor = resolveActor(() => getDeps().resolveSession);
  app.use("/communities/:communityId/payments/comps", actor);
  app.use("/communities/:communityId/payments/comps/*", actor);

  const payments = () => getDeps().payments;

  return app
    .openapi(listComps, async (c) => {
      const items = await payments().listComps(c.get("actor"), c.req.valid("param").communityId);
      return c.json(compListJson(items), 200);
    })
    .openapi(grantComp, async (c) => {
      const body = c.req.valid("json");
      const result = await payments().grantComp(c.get("actor"), c.req.valid("param").communityId, {
        ...(body.email ? { email: body.email } : {}),
        ...(body.userId ? { userId: body.userId } : {}),
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        ...(body.note ? { note: body.note } : {}),
      });
      if (result.kind === "invited") {
        return c.json(compInvitationJson(result.invitation), 202);
      }
      return c.json(compJson(result.comp), 201);
    })
    .openapi(listCompInvitations, async (c) => {
      const items = await payments().listCompInvitations(
        c.get("actor"),
        c.req.valid("param").communityId,
      );
      return c.json(compInvitationListJson(items), 200);
    })
    .openapi(withdrawCompInvitation, async (c) => {
      const { communityId, invitationId } = c.req.valid("param");
      return c.json(
        compInvitationJson(
          await payments().withdrawCompInvitation(c.get("actor"), communityId, invitationId),
        ),
        200,
      );
    })
    .openapi(listMyCompOffers, async (c) => {
      const offers = await payments().listMyCompInvitations(
        c.get("actor"),
        c.req.valid("param").communityId,
      );
      return c.json(compOfferListJson(offers), 200);
    })
    .openapi(acceptCompOffer, async (c) => {
      const { communityId, invitationId } = c.req.valid("param");
      return c.json(
        compJson(await payments().acceptCompInvitation(c.get("actor"), communityId, invitationId)),
        200,
      );
    })
    .openapi(revokeComp, async (c) => {
      const { communityId, compId } = c.req.valid("param");
      return c.json(
        compJson(await payments().revokeComp(c.get("actor"), communityId, compId)),
        200,
      );
    });
}
