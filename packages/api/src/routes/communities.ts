import { createRoute, z } from "@hono/zod-openapi";
import type {
  CommunitiesService,
  CommunityPublicView,
  CommunityView,
  GalleryItemView,
  MembershipView,
} from "@cohory/communities";

import { cursorPage } from "../pagination";
import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { errorResponseSchema } from "../errors";
import { resolveActor, type SessionResolver } from "../middleware/session";
import { galleryItemJson, galleryListSchema } from "./gallery-schemas";
import { contentDocumentSchema } from "./posts-schemas";
import { bodyLimit } from "hono/body-limit";

const writeLimit = bodyLimit({ maxSize: 64 * 1024 });

export interface CommunitiesRouteDeps {
  resolveSession: SessionResolver;
  communities: CommunitiesService;
}

const coverUrlSchema = z.string().nullable().openapi({ description: "Cover image URL, if set." });
const memberCountSchema = z.int().nonnegative().openapi({ description: "Active members." });
const joinModeSchema = z.enum(["open", "approval", "invite"]);
const detailedDescriptionSchema = contentDocumentSchema.nullable();
const gallerySchema = galleryListSchema.openapi({
  description: "The About page gallery in display order. The first item is the hero.",
});
const joinQuestionsSchema = z
  .array(z.object({ text: z.string(), required: z.boolean() }))
  .openapi({ description: "Questions shown with Request to join when the join mode is approval." });

export const communitySchema = z
  .object({
    access: z.literal("full"),
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    privacy: z.enum(["private", "public"]),
    joinMode: joinModeSchema,
    joinQuestions: joinQuestionsSchema,
    coverUrl: coverUrlSchema,
    memberCount: memberCountSchema,
    detailedDescription: detailedDescriptionSchema,
    createdAt: z.iso.datetime().openapi({ description: "ISO 8601 UTC timestamp." }),
    archivedAt: z.iso.datetime().nullable().openapi({
      description: "Set while the community is archived and read only. ISO 8601 UTC timestamp.",
    }),
  })
  .openapi("Community");

export const communityPublicSchema = z
  .object({
    access: z.literal("limited"),
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    privacy: z.literal("private"),
    joinMode: joinModeSchema,
    joinQuestions: joinQuestionsSchema,
    coverUrl: coverUrlSchema,
    memberCount: memberCountSchema,
    detailedDescription: detailedDescriptionSchema,
    gallery: gallerySchema,
  })
  .openapi("CommunityAbout", {
    description: "The About view of a private community for people who are not active members.",
  });

const communityDetailSchema = communitySchema
  .extend({ gallery: gallerySchema })
  .openapi("CommunityDetail", {
    description: "The full community with its About page gallery.",
  });

export const membershipSchema = z
  .object({
    id: z.uuid(),
    communityId: z.uuid(),
    userId: z.uuid(),
    role: z.enum(["owner", "admin", "moderator", "member"]),
    status: z.enum(["pending", "active", "removed", "banned"]),
    joinedAt: z.iso.datetime().nullable().openapi({ description: "ISO 8601 UTC timestamp." }),
  })
  .openapi("Membership");

const communityWithMembershipSchema = z
  .object({ community: communitySchema, membership: membershipSchema })
  .openapi("CommunityWithMembership");

const createCommunityBodySchema = z
  .object({
    name: z.string().min(1).max(80).openapi({ example: "Makers Guild" }),
    slug: z
      .string()
      .min(3)
      .max(48)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .openapi({ example: "makers-guild" }),
    description: z.string().max(2000).nullish(),
    privacy: z.enum(["private", "public"]).optional().openapi({ default: "private" }),
  })
  .openapi("CreateCommunity");

const slugParams = z.object({
  slug: z.string().openapi({ param: { name: "slug", in: "path" }, example: "makers-guild" }),
});

type SecurityRequirement = Record<string, string[]>;

const sessionSecurity: SecurityRequirement[] = [{ sessionCookie: [] }];
const optionalSessionSecurity: SecurityRequirement[] = [{}, { sessionCookie: [] }];

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: errorResponseSchema } } };
}

function json<T extends z.ZodType>(schema: T, description: string) {
  return { description, content: { "application/json": { schema } } };
}

const unauthenticated = errorResponse("Sign in required.");
const notFound = errorResponse("The community does not exist or is not visible to the caller.");

const createCommunityRoute = createRoute({
  method: "post",
  path: "/communities",
  operationId: "createCommunity",
  "x-cohory": routeMeta("createCommunity"),
  tags: ["Communities"],
  summary: "Create a community",
  description:
    "Creates a community and makes the caller its owner in one transaction. Requires a signed in person.",
  security: sessionSecurity,
  middleware: [writeLimit] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createCommunityBodySchema } },
    },
  },
  responses: {
    201: json(communityWithMembershipSchema, "The new community and the owner membership."),
    401: unauthenticated,
    409: errorResponse("The slug is already taken."),
    422: errorResponse("The body is invalid or the slug is reserved."),
  },
});

const listMyCommunitiesRoute = createRoute({
  method: "get",
  path: "/communities/me",
  operationId: "listMyCommunities",
  "x-cohory": routeMeta("listMyCommunities"),
  tags: ["Communities"],
  summary: "List the caller's communities",
  description:
    "Lists every community where the caller has an active membership in one page, so nextCursor is always null.",
  security: sessionSecurity,
  responses: {
    200: json(
      cursorPage(communityWithMembershipSchema).openapi("CommunityList"),
      "The caller's communities with their memberships.",
    ),
    401: unauthenticated,
  },
});

const getCommunityRoute = createRoute({
  method: "get",
  path: "/communities/{slug}",
  operationId: "getCommunity",
  "x-cohory": routeMeta("getCommunity"),
  tags: ["Communities"],
  summary: "Get a community by slug",
  description:
    "Returns the full community to anyone for a public community and to active members for a private one. Everyone else gets the limited About view of a private community (`access` is `limited`).",
  security: optionalSessionSecurity,
  request: { params: slugParams },
  responses: {
    200: json(
      z.discriminatedUnion("access", [communityDetailSchema, communityPublicSchema]),
      "The community, or its About view.",
    ),
    404: notFound,
  },
});

const joinCommunityRoute = createRoute({
  method: "post",
  path: "/communities/{slug}/join",
  operationId: "joinCommunity",
  "x-cohory": routeMeta("joinCommunity"),
  tags: ["Memberships"],
  summary: "Join a community",
  description:
    "Joins a free public community with open join. Returns the existing membership when the caller is already a member.",
  security: sessionSecurity,
  middleware: [writeLimit] as const,
  request: { params: slugParams },
  responses: {
    200: json(membershipSchema, "The caller's membership."),
    401: unauthenticated,
    403: errorResponse("The caller may not join this community."),
    404: notFound,
  },
});

const leaveCommunityRoute = createRoute({
  method: "post",
  path: "/communities/{slug}/leave",
  operationId: "leaveCommunity",
  "x-cohory": routeMeta("leaveCommunity"),
  tags: ["Memberships"],
  summary: "Leave a community",
  description:
    "Ends the caller's membership. The owner cannot leave. The caller can join again later.",
  security: sessionSecurity,
  middleware: [writeLimit] as const,
  request: { params: slugParams },
  responses: {
    200: json(membershipSchema, "The ended membership."),
    401: unauthenticated,
    404: errorResponse("The community is not visible or the caller is not a member."),
    409: errorResponse("The owner cannot leave."),
  },
});

const getMembershipRoute = createRoute({
  method: "get",
  path: "/communities/{slug}/membership",
  operationId: "getMyMembership",
  "x-cohory": routeMeta("getMyMembership"),
  tags: ["Memberships"],
  summary: "Get the caller's membership",
  description: "Returns the caller's membership in the community, or null when there is none.",
  security: sessionSecurity,
  request: { params: slugParams },
  responses: {
    200: json(
      z.object({ membership: membershipSchema.nullable() }).openapi("MembershipResult"),
      "The caller's membership or null.",
    ),
    401: unauthenticated,
    404: notFound,
  },
});

function descriptionJson(view: CommunityView | CommunityPublicView) {
  return view.detailedDescription
    ? { type: "doc" as const, content: [...view.detailedDescription.content] }
    : null;
}

function communityJson(view: CommunityView): z.infer<typeof communitySchema> {
  return {
    ...view,
    detailedDescription: descriptionJson(view),
    joinQuestions: view.joinQuestions.map((question) => ({ ...question })),
    createdAt: view.createdAt.toISOString(),
    archivedAt: view.archivedAt?.toISOString() ?? null,
  };
}

function communityLookupJson(
  view: CommunityView | CommunityPublicView,
  gallery: readonly GalleryItemView[],
): z.infer<typeof communityDetailSchema> | z.infer<typeof communityPublicSchema> {
  const items = gallery.map(galleryItemJson);
  if (view.access === "full") {
    return { ...communityJson(view), gallery: items };
  }
  return {
    ...view,
    privacy: "private",
    detailedDescription: descriptionJson(view),
    joinQuestions: view.joinQuestions.map((question) => ({ ...question })),
    gallery: items,
  };
}

function membershipJson(view: MembershipView): z.infer<typeof membershipSchema> {
  return { ...view, joinedAt: view.joinedAt?.toISOString() ?? null };
}

export function createCommunitiesRoutes(getDeps: () => CommunitiesRouteDeps) {
  const app = createRouter();
  app.use(
    "/communities",
    resolveActor(() => getDeps().resolveSession),
  );
  app.use(
    "/communities/*",
    resolveActor(() => getDeps().resolveSession),
  );

  return app
    .openapi(createCommunityRoute, async (c) => {
      const result = await getDeps().communities.createCommunity(
        c.get("actor"),
        c.req.valid("json"),
      );
      return c.json(
        {
          community: communityJson(result.community),
          membership: membershipJson(result.membership),
        },
        201,
      );
    })
    .openapi(listMyCommunitiesRoute, async (c) => {
      const rows = await getDeps().communities.listCommunitiesForUser(c.get("actor"));
      return c.json(
        {
          data: rows.map((row) => ({
            community: communityJson(row.community),
            membership: membershipJson(row.membership),
          })),
          nextCursor: null,
        },
        200,
      );
    })
    .openapi(getCommunityRoute, async (c) => {
      const { communities } = getDeps();
      const actor = c.get("actor");
      const community = await communities.getCommunityBySlug(actor, c.req.valid("param").slug);
      const gallery = await communities.listGallery(actor, community.id);
      return c.json(communityLookupJson(community, gallery), 200);
    })
    .openapi(joinCommunityRoute, async (c) => {
      const { communities } = getDeps();
      const actor = c.get("actor");
      const community = await communities.getCommunityBySlug(actor, c.req.valid("param").slug);
      return c.json(membershipJson(await communities.joinCommunity(actor, community.id)), 200);
    })
    .openapi(leaveCommunityRoute, async (c) => {
      const { communities } = getDeps();
      const actor = c.get("actor");
      const community = await communities.getCommunityBySlug(actor, c.req.valid("param").slug);
      return c.json(membershipJson(await communities.leaveCommunity(actor, community.id)), 200);
    })
    .openapi(getMembershipRoute, async (c) => {
      const { communities } = getDeps();
      const actor = c.get("actor");
      const community = await communities.getCommunityBySlug(actor, c.req.valid("param").slug);
      const membership = await communities.getMembership(actor, community.id);
      return c.json({ membership: membership ? membershipJson(membership) : null }, 200);
    });
}
