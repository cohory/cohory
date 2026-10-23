import { createRoute, z } from "@hono/zod-openapi";
import type { Actor } from "@cohory/authz";
import { bodyLimit } from "hono/body-limit";

import { pageCursor } from "../pagination";
import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { resolveActor } from "../middleware/session";
import type { PostsRouteDeps } from "./posts";
import {
  errorResponse,
  json,
  postJson,
  postSchema,
  slugParams,
  updateScheduledPostBodySchema,
} from "./posts-schemas";

const writeLimit = bodyLimit({ maxSize: 512 * 1024 });

const security = [{ sessionCookie: [] }];
const tags = ["Posts"];
const errors = {
  401: errorResponse("Sign in required."),
  403: errorResponse("The caller is not allowed to do this in the community."),
  404: errorResponse("The community or scheduled post does not exist or is not visible."),
  422: errorResponse("The input is invalid."),
};
const published = errorResponse("The post is already published (code post_not_scheduled).");

const scheduledParams = slugParams.extend({
  postId: z.uuid().openapi({ param: { name: "postId", in: "path" } }),
});

const scheduledPostListSchema = z
  .object({ data: z.array(postSchema).max(100), ...pageCursor })
  .openapi("ScheduledPostList");

const listScheduled = createRoute({
  method: "get",
  path: "/communities/{slug}/scheduled-posts",
  operationId: "listScheduledPosts",
  "x-cohory": routeMeta("listScheduledPosts"),
  tags,
  security,
  summary: "List scheduled posts",
  description:
    "Posts waiting to be published, soonest first, up to 100. Members see their own; moderators, admins, and the owner see everyone's.",
  request: { params: slugParams },
  responses: { 200: json(scheduledPostListSchema, "The scheduled posts."), ...errors },
});

const updateScheduled = createRoute({
  method: "patch",
  path: "/communities/{slug}/scheduled-posts/{postId}",
  operationId: "updateScheduledPost",
  "x-cohory": routeMeta("updateScheduledPost"),
  tags,
  security,
  summary: "Edit or reschedule a scheduled post",
  description: "Only the author can change the title, the body, or the publish time.",
  middleware: [writeLimit] as const,
  request: {
    params: scheduledParams,
    body: {
      required: true,
      content: { "application/json": { schema: updateScheduledPostBodySchema } },
    },
  },
  responses: {
    200: json(postSchema, "The scheduled post."),
    ...errors,
    409: errorResponse("The post is already published, or the community is archived."),
  },
});

const cancelScheduled = createRoute({
  method: "delete",
  path: "/communities/{slug}/scheduled-posts/{postId}",
  operationId: "cancelScheduledPost",
  "x-cohory": routeMeta("cancelScheduledPost"),
  tags,
  security,
  summary: "Cancel a scheduled post",
  description:
    "Deletes the post before it is published. Nobody is notified. The author, moderators, admins, and the owner can cancel.",
  middleware: [writeLimit] as const,
  request: { params: scheduledParams },
  responses: {
    204: { description: "The scheduled post is cancelled." },
    ...errors,
    409: published,
  },
});

const publishScheduled = createRoute({
  method: "post",
  path: "/communities/{slug}/scheduled-posts/{postId}/publish",
  operationId: "publishScheduledPost",
  "x-cohory": routeMeta("publishScheduledPost"),
  tags,
  security,
  summary: "Publish a scheduled post now",
  description: "Only the author can publish early. Notifications and webhooks fire now.",
  middleware: [writeLimit] as const,
  request: { params: scheduledParams },
  responses: {
    200: json(postSchema, "The published post."),
    ...errors,
    409: errorResponse("The post is already published, or the community is archived."),
  },
});

export function createScheduledPostsRoutes(getDeps: () => PostsRouteDeps) {
  const app = createRouter();
  const actor = resolveActor(() => getDeps().resolveSession);
  app.use("/communities/:slug/scheduled-posts", actor);
  app.use("/communities/:slug/scheduled-posts/*", actor);

  async function communityId(caller: Actor, slug: string): Promise<string> {
    return (await getDeps().communities.getCommunityBySlug(caller, slug)).id;
  }

  return app
    .openapi(listScheduled, async (c) => {
      const caller = c.get("actor");
      const posts = await getDeps().posts.listScheduledPosts(
        caller,
        await communityId(caller, c.req.valid("param").slug),
      );
      return c.json({ data: posts.map(postJson), nextCursor: null }, 200);
    })
    .openapi(updateScheduled, async (c) => {
      const caller = c.get("actor");
      const { slug, postId } = c.req.valid("param");
      const post = await getDeps().posts.updateScheduledPost(
        caller,
        await communityId(caller, slug),
        postId,
        c.req.valid("json"),
      );
      return c.json(postJson(post), 200);
    })
    .openapi(cancelScheduled, async (c) => {
      const caller = c.get("actor");
      const { slug, postId } = c.req.valid("param");
      await getDeps().posts.cancelScheduledPost(caller, await communityId(caller, slug), postId);
      return c.body(null, 204);
    })
    .openapi(publishScheduled, async (c) => {
      const caller = c.get("actor");
      const { slug, postId } = c.req.valid("param");
      const { post } = await getDeps().posts.publishScheduledPost(
        caller,
        await communityId(caller, slug),
        postId,
      );
      return c.json(postJson(post), 200);
    });
}
