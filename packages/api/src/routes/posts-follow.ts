import { createRoute } from "@hono/zod-openapi";
import type { Actor } from "@cohory/authz";

import { createRouter } from "../create-router";
import { resolveActor } from "../middleware/session";
import { routeMeta } from "../route-meta";
import type { PostsRouteDeps } from "./posts";
import {
  errorResponse,
  followJson,
  followStateSchema,
  json,
  memberEmailResultSchema,
  memberEmailStatusJson,
  memberEmailStatusSchema,
  postParams,
  slugParams,
} from "./posts-schemas";

const security = [{ sessionCookie: [] }];
const tags = ["Posts"];
const errors = {
  401: errorResponse("Sign in required."),
  403: errorResponse("The caller is not allowed to do this in the community."),
  404: errorResponse("The community or post does not exist or is not visible."),
  422: errorResponse("The input is invalid."),
};

const followPost = createRoute({
  method: "put",
  path: "/communities/{slug}/posts/{postId}/follow",
  operationId: "followPost",
  "x-cohory": routeMeta("followPost"),
  tags,
  security,
  summary: "Follow a post",
  description:
    "The caller gets a notification for new comments on the post. Members who can read the post may follow it; commenting follows it on its own.",
  request: { params: postParams },
  responses: { 200: json(followStateSchema, "The caller follows the post."), ...errors },
});

const unfollowPost = createRoute({
  method: "delete",
  path: "/communities/{slug}/posts/{postId}/follow",
  operationId: "unfollowPost",
  "x-cohory": routeMeta("unfollowPost"),
  tags,
  security,
  summary: "Stop following a post",
  description: "Works even after the caller lost access to the post.",
  request: { params: postParams },
  responses: { 200: json(followStateSchema, "The caller no longer follows the post."), ...errors },
});

const getMemberEmailStatus = createRoute({
  method: "get",
  path: "/communities/{slug}/member-email",
  operationId: "getMemberEmailStatus",
  "x-cohory": routeMeta("getMemberEmailStatus"),
  tags,
  security,
  summary: "When a post may next be emailed to all members",
  description:
    "Owners and admins can email one published post to all members every 24 hours. Signed in people only, never API tokens.",
  request: { params: slugParams },
  responses: { 200: json(memberEmailStatusSchema, "The member email status."), ...errors },
});

const emailPostToMembers = createRoute({
  method: "post",
  path: "/communities/{slug}/posts/{postId}/email-members",
  operationId: "emailPostToMembers",
  "x-cohory": routeMeta("emailPostToMembers"),
  tags,
  security,
  summary: "Email a post to all members",
  description:
    "Queues an email of the published post to every member who did not turn these emails off. Once per community every 24 hours. Owners and admins, signed in people only, never API tokens.",
  request: { params: postParams },
  responses: {
    202: json(memberEmailResultSchema, "The email is queued."),
    ...errors,
    409: errorResponse(
      "A post was emailed in the last 24 hours (code member_email_too_soon), or the community is archived.",
    ),
  },
});

export function createPostFollowRoutes(getDeps: () => PostsRouteDeps) {
  const app = createRouter();
  app.use(
    "/communities/:slug/member-email",
    resolveActor(() => getDeps().resolveSession),
  );

  async function communityId(caller: Actor, slug: string): Promise<string> {
    return (await getDeps().communities.getCommunityBySlug(caller, slug)).id;
  }

  return app
    .openapi(followPost, async (c) => {
      const caller = c.get("actor");
      const { slug, postId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(followJson(await getDeps().posts.followPost(caller, id, postId)), 200);
    })
    .openapi(unfollowPost, async (c) => {
      const caller = c.get("actor");
      const { slug, postId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(followJson(await getDeps().posts.unfollowPost(caller, id, postId)), 200);
    })
    .openapi(getMemberEmailStatus, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const status = await getDeps().posts.getMemberEmailStatus(caller, id);
      return c.json(memberEmailStatusJson(status), 200);
    })
    .openapi(emailPostToMembers, async (c) => {
      const caller = c.get("actor");
      const { slug, postId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const { sentAt } = await getDeps().posts.emailPostToMembers(caller, id, postId);
      return c.json({ sentAt: sentAt.toISOString() }, 202);
    });
}
