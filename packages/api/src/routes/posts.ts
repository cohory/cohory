import { createRoute, z } from "@hono/zod-openapi";
import type { Actor } from "@cohory/authz";
import type { CommunitiesService } from "@cohory/communities";
import type { PostsService } from "@cohory/posts";
import { bodyLimit } from "hono/body-limit";

import { pageCursor } from "../pagination";
import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { resolveActor, type SessionResolver } from "../middleware/session";
import { createPostFollowRoutes } from "./posts-follow";
import { createScheduledPostsRoutes } from "./posts-scheduled";
import {
  archived,
  tooManyRequests,
  commentJson,
  commentParams,
  commentSchema,
  commentThreadSchema,
  createCommentBodySchema,
  draftParams,
  createPostBodySchema,
  errorResponse,
  imageUploadFormSchema,
  json,
  likeJson,
  likeStateSchema,
  page,
  feedQuerySchema,
  pageQuerySchema,
  postJson,
  postParams,
  postSchema,
  slugParams,
  threadJson,
  updateCommentBodySchema,
  updatePostBodySchema,
  uploadedImageSchema,
} from "./posts-schemas";

const jsonWriteLimit = bodyLimit({ maxSize: 512 * 1024 });
const uploadLimit = bodyLimit({ maxSize: 10 * 1024 * 1024 + 64 * 1024 });

export interface PostsRouteDeps {
  resolveSession: SessionResolver;
  communities: CommunitiesService;
  posts: PostsService;
}

type SecurityRequirement = Record<string, string[]>;

const sessionSecurity: SecurityRequirement[] = [{ sessionCookie: [] }];
const optionalSessionSecurity: SecurityRequirement[] = [{}, { sessionCookie: [] }];
const rateLimitNote =
  " Rate limited per member (see docs/self-hosting.md); over the limit the API answers 429 with a Retry-After header.";

const unauthenticated = errorResponse("Sign in required.");
const forbidden = errorResponse("The caller is not allowed to do this in the community.");
const notFound = errorResponse("The community, post, or comment does not exist or is not visible.");
const invalid = errorResponse("The input is invalid.");
const postResponse = (description: string) => json(postSchema, description);

function jsonBody<T extends z.ZodType>(schema: T) {
  return { body: { required: true, content: { "application/json": { schema } } } };
}

const listPosts = createRoute({
  method: "get",
  path: "/communities/{slug}/posts",
  operationId: "listPosts",
  "x-cohory": routeMeta("listPosts"),
  tags: ["Posts"],
  summary: "List the community feed",
  description:
    "Pinned posts first, then by `sort` (latest activity by default), optionally filtered by `category`. Cursor pagination with `cursor` and `limit` (default 20, max 100). Guests can read the feed of a public community.",
  security: optionalSessionSecurity,
  request: { params: slugParams, query: feedQuerySchema },
  responses: {
    200: json(page(postSchema, "PostPage"), "A page of posts."),
    403: forbidden,
    404: notFound,
    422: invalid,
  },
});

const createPost = createRoute({
  method: "post",
  path: "/communities/{slug}/posts",
  operationId: "createPost",
  "x-cohory": routeMeta("createPost"),
  tags: ["Posts"],
  summary: "Create a post",
  description: `Creates a post as the caller. Images must be uploaded first with the post image upload endpoint.${rateLimitNote}`,
  security: sessionSecurity,
  middleware: [jsonWriteLimit] as const,
  request: { params: slugParams, ...jsonBody(createPostBodySchema) },
  responses: {
    201: postResponse("The new post."),
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: archived,
    422: invalid,
    429: tooManyRequests,
  },
});

const getPost = createRoute({
  method: "get",
  path: "/communities/{slug}/posts/{postId}",
  operationId: "getPost",
  "x-cohory": routeMeta("getPost"),
  tags: ["Posts"],
  summary: "Get a post",
  security: optionalSessionSecurity,
  request: { params: postParams },
  responses: { 200: postResponse("The post."), 403: forbidden, 404: notFound, 422: invalid },
});

const updatePost = createRoute({
  method: "patch",
  path: "/communities/{slug}/posts/{postId}",
  operationId: "updatePost",
  "x-cohory": routeMeta("updatePost"),
  tags: ["Posts"],
  summary: "Edit a post",
  description: "Only the author can edit a post. The post is marked as edited.",
  security: sessionSecurity,
  middleware: [jsonWriteLimit] as const,
  request: { params: postParams, ...jsonBody(updatePostBodySchema) },
  responses: {
    200: postResponse("The edited post."),
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    422: invalid,
  },
});

const deletePost = createRoute({
  method: "delete",
  path: "/communities/{slug}/posts/{postId}",
  operationId: "deletePost",
  "x-cohory": routeMeta("deletePost"),
  tags: ["Posts"],
  summary: "Delete a post",
  description: "The author, moderators, admins, and the owner can delete a post. Deletes are soft.",
  security: sessionSecurity,
  middleware: [jsonWriteLimit] as const,
  request: { params: postParams },
  responses: {
    204: { description: "The post is deleted." },
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    422: invalid,
  },
});

function pinRoute(method: "post" | "delete") {
  const pin = method === "post";
  return createRoute({
    method,
    path: "/communities/{slug}/posts/{postId}/pin",
    operationId: pin ? "pinPost" : "unpinPost",
    "x-cohory": routeMeta(pin ? "pinPost" : "unpinPost"),
    tags: ["Posts"],
    summary: pin ? "Pin a post" : "Unpin a post",
    description: pin
      ? "Admins and the owner can pin up to three posts. Pinning a pinned post changes nothing."
      : "Admins and the owner can unpin a post.",
    security: sessionSecurity,
    request: { params: postParams },
    responses: {
      200: postResponse("The post."),
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      ...(pin ? { 409: errorResponse("The community already has three pinned posts.") } : {}),
      422: invalid,
    },
  });
}

function likeDetails(noun: "Post" | "Comment", method: "post" | "delete") {
  const like = method === "post";
  return {
    method,
    operationId: `${like ? "like" : "unlike"}${noun}`,
    "x-cohory": routeMeta(`${like ? "like" : "unlike"}${noun}`),
    tags: [noun === "Post" ? "Posts" : "Comments"],
    summary: `${like ? "Like" : "Remove the like from"} a ${noun.toLowerCase()}`,
    description: `Idempotent. Repeating the call returns the same state.${rateLimitNote}`,
    security: sessionSecurity,
    responses: {
      200: json(likeStateSchema, "The caller's like state and the like count."),
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: archived,
      422: invalid,
      429: tooManyRequests,
    },
  };
}

function postLikeRoute(method: "post" | "delete") {
  return createRoute({
    ...likeDetails("Post", method),
    path: "/communities/{slug}/posts/{postId}/like",
    request: { params: postParams },
  });
}

function commentLikeRoute(method: "post" | "delete") {
  return createRoute({
    ...likeDetails("Comment", method),
    path: "/communities/{slug}/comments/{commentId}/like",
    request: { params: commentParams },
  });
}

const listComments = createRoute({
  method: "get",
  path: "/communities/{slug}/posts/{postId}/comments",
  operationId: "listComments",
  "x-cohory": routeMeta("listComments"),
  tags: ["Comments"],
  summary: "List comments on a post",
  description:
    "Top level comments oldest first, each with its replies. Cursor pagination over top level comments (default 50, max 100).",
  security: optionalSessionSecurity,
  request: { params: postParams, query: pageQuerySchema },
  responses: {
    200: json(page(commentThreadSchema, "CommentPage"), "A page of comment threads."),
    403: forbidden,
    404: notFound,
    422: invalid,
  },
});

const createComment = createRoute({
  method: "post",
  path: "/communities/{slug}/posts/{postId}/comments",
  operationId: "createComment",
  "x-cohory": routeMeta("createComment"),
  tags: ["Comments"],
  summary: "Comment on a post",
  description: `Set \`parentId\` to reply to a top level comment. Replies cannot have replies. Images are not allowed in comments.${rateLimitNote}`,
  security: sessionSecurity,
  middleware: [jsonWriteLimit] as const,
  request: { params: postParams, ...jsonBody(createCommentBodySchema) },
  responses: {
    201: json(commentSchema, "The new comment."),
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: archived,
    422: invalid,
    429: tooManyRequests,
  },
});

const updateComment = createRoute({
  method: "patch",
  path: "/communities/{slug}/comments/{commentId}",
  operationId: "updateComment",
  "x-cohory": routeMeta("updateComment"),
  tags: ["Comments"],
  summary: "Edit a comment",
  description: "Only the author can edit a comment.",
  security: sessionSecurity,
  middleware: [jsonWriteLimit] as const,
  request: { params: commentParams, ...jsonBody(updateCommentBodySchema) },
  responses: {
    200: json(commentSchema, "The edited comment."),
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    422: invalid,
  },
});

const deleteComment = createRoute({
  method: "delete",
  path: "/communities/{slug}/comments/{commentId}",
  operationId: "deleteComment",
  "x-cohory": routeMeta("deleteComment"),
  tags: ["Comments"],
  summary: "Delete a comment",
  description:
    "The author, moderators, admins, and the owner can delete a comment. Deleting a top level comment also hides its replies. Deletes are soft.",
  security: sessionSecurity,
  middleware: [jsonWriteLimit] as const,
  request: { params: commentParams },
  responses: {
    204: { description: "The comment is deleted." },
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    422: invalid,
  },
});

const uploadPostImage = createRoute({
  method: "post",
  path: "/communities/{slug}/uploads/post-image",
  operationId: "uploadPostImage",
  "x-cohory": routeMeta("uploadPostImage"),
  tags: ["Posts"],
  summary: "Upload an image for a post",
  description: `Accepts one PNG, JPEG, WebP, or GIF image up to 10 MB in the \`file\` field. Returns the key to reference in an image node of a post body.${rateLimitNote}`,
  security: sessionSecurity,
  middleware: [uploadLimit] as const,
  request: {
    params: slugParams,
    body: { required: true, content: { "multipart/form-data": { schema: imageUploadFormSchema } } },
  },
  responses: {
    201: json(uploadedImageSchema, "The stored image."),
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    422: errorResponse("The file is missing, too large, or not a supported image."),
  },
});

const listPostDrafts = createRoute({
  method: "get",
  path: "/communities/{slug}/post-drafts",
  operationId: "listPostDrafts",
  "x-cohory": routeMeta("listPostDrafts"),
  tags: ["Posts"],
  summary: "List post drafts",
  description:
    "Drafts written by agents, oldest first. People see their own agents' drafts, admins and the owner see every draft, and an agent sees only its own.",
  security: sessionSecurity,
  request: { params: slugParams },
  responses: {
    200: json(z.object({ data: z.array(postSchema), ...pageCursor }), "The drafts."),
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

const publishPostDraft = createRoute({
  method: "post",
  path: "/communities/{slug}/post-drafts/{draftId}/publish",
  operationId: "publishPostDraft",
  "x-cohory": routeMeta("publishPostDraft"),
  tags: ["Posts"],
  summary: "Publish a post draft",
  description:
    "Publishes an agent's draft as a post by its author, keeping the Agent badge. The author, admins, and the owner can publish. Needs a signed in session.",
  security: sessionSecurity,
  middleware: [jsonWriteLimit] as const,
  request: { params: draftParams },
  responses: {
    201: postResponse("The published post."),
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: archived,
    422: invalid,
  },
});

const discardPostDraft = createRoute({
  method: "delete",
  path: "/communities/{slug}/post-drafts/{draftId}",
  operationId: "discardPostDraft",
  "x-cohory": routeMeta("discardPostDraft"),
  tags: ["Posts"],
  summary: "Discard a post draft",
  description: "The author, admins, and the owner can discard. Needs a signed in session.",
  security: sessionSecurity,
  middleware: [jsonWriteLimit] as const,
  request: { params: draftParams },
  responses: {
    204: { description: "The draft is discarded." },
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

export function createPostsRoutes(getDeps: () => PostsRouteDeps) {
  const app = createRouter();
  const actor = resolveActor(() => getDeps().resolveSession);
  app.use("/communities/:slug/posts", actor);
  app.use("/communities/:slug/posts/*", actor);
  app.use("/communities/:slug/comments/*", actor);
  app.use("/communities/:slug/uploads/*", actor);
  app.use("/communities/:slug/post-drafts", actor);
  app.use("/communities/:slug/post-drafts/*", actor);

  async function communityId(caller: Actor, slug: string): Promise<string> {
    return (await getDeps().communities.getCommunityBySlug(caller, slug)).id;
  }

  return app
    .openapi(listPostDrafts, async (c) => {
      const caller = c.get("actor");
      const drafts = await getDeps().posts.listDrafts(
        caller,
        await communityId(caller, c.req.valid("param").slug),
      );
      return c.json({ data: drafts.map(postJson), nextCursor: null }, 200);
    })
    .openapi(publishPostDraft, async (c) => {
      const caller = c.get("actor");
      const { slug, draftId } = c.req.valid("param");
      const { post } = await getDeps().posts.publishDraft(
        caller,
        await communityId(caller, slug),
        draftId,
      );
      return c.json(postJson(post), 201);
    })
    .openapi(discardPostDraft, async (c) => {
      const caller = c.get("actor");
      const { slug, draftId } = c.req.valid("param");
      await getDeps().posts.discardDraft(caller, await communityId(caller, slug), draftId);
      return c.body(null, 204);
    })
    .openapi(listPosts, async (c) => {
      const caller = c.get("actor");
      const { slug } = c.req.valid("param");
      const result = await getDeps().posts.listFeed(
        caller,
        await communityId(caller, slug),
        c.req.valid("query"),
      );
      return c.json({ data: result.data.map(postJson), nextCursor: result.nextCursor }, 200);
    })
    .openapi(createPost, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const { post } = await getDeps().posts.createPost(caller, id, c.req.valid("json"));
      return c.json(postJson(post), 201);
    })
    .openapi(getPost, async (c) => {
      const caller = c.get("actor");
      const { slug, postId } = c.req.valid("param");
      const post = await getDeps().posts.getPost(caller, await communityId(caller, slug), postId);
      return c.json(postJson(post), 200);
    })
    .openapi(updatePost, async (c) => {
      const caller = c.get("actor");
      const { slug, postId } = c.req.valid("param");
      const post = await getDeps().posts.updatePost(
        caller,
        await communityId(caller, slug),
        postId,
        c.req.valid("json"),
      );
      return c.json(postJson(post), 200);
    })
    .openapi(deletePost, async (c) => {
      const caller = c.get("actor");
      const { slug, postId } = c.req.valid("param");
      await getDeps().posts.deletePost(caller, await communityId(caller, slug), postId);
      return c.body(null, 204);
    })
    .openapi(pinRoute("post"), async (c) => {
      const caller = c.get("actor");
      const { slug, postId } = c.req.valid("param");
      const post = await getDeps().posts.pinPost(caller, await communityId(caller, slug), postId);
      return c.json(postJson(post), 200);
    })
    .openapi(pinRoute("delete"), async (c) => {
      const caller = c.get("actor");
      const { slug, postId } = c.req.valid("param");
      const post = await getDeps().posts.unpinPost(caller, await communityId(caller, slug), postId);
      return c.json(postJson(post), 200);
    })
    .openapi(postLikeRoute("post"), async (c) => {
      const caller = c.get("actor");
      const { slug, postId } = c.req.valid("param");
      const state = await getDeps().posts.toggleLike(caller, await communityId(caller, slug), {
        subjectType: "post",
        subjectId: postId,
        liked: true,
      });
      return c.json(likeJson(state), 200);
    })
    .openapi(postLikeRoute("delete"), async (c) => {
      const caller = c.get("actor");
      const { slug, postId } = c.req.valid("param");
      const state = await getDeps().posts.toggleLike(caller, await communityId(caller, slug), {
        subjectType: "post",
        subjectId: postId,
        liked: false,
      });
      return c.json(likeJson(state), 200);
    })
    .openapi(listComments, async (c) => {
      const caller = c.get("actor");
      const { slug, postId } = c.req.valid("param");
      const result = await getDeps().posts.listComments(
        caller,
        await communityId(caller, slug),
        postId,
        c.req.valid("query"),
      );
      return c.json({ data: result.data.map(threadJson), nextCursor: result.nextCursor }, 200);
    })
    .openapi(createComment, async (c) => {
      const caller = c.get("actor");
      const { slug, postId } = c.req.valid("param");
      const { comment } = await getDeps().posts.createComment(
        caller,
        await communityId(caller, slug),
        postId,
        c.req.valid("json"),
      );
      return c.json(commentJson(comment), 201);
    })
    .openapi(updateComment, async (c) => {
      const caller = c.get("actor");
      const { slug, commentId } = c.req.valid("param");
      const comment = await getDeps().posts.updateComment(
        caller,
        await communityId(caller, slug),
        commentId,
        c.req.valid("json"),
      );
      return c.json(commentJson(comment), 200);
    })
    .openapi(deleteComment, async (c) => {
      const caller = c.get("actor");
      const { slug, commentId } = c.req.valid("param");
      await getDeps().posts.deleteComment(caller, await communityId(caller, slug), commentId);
      return c.body(null, 204);
    })
    .openapi(commentLikeRoute("post"), async (c) => {
      const caller = c.get("actor");
      const { slug, commentId } = c.req.valid("param");
      const state = await getDeps().posts.toggleLike(caller, await communityId(caller, slug), {
        subjectType: "comment",
        subjectId: commentId,
        liked: true,
      });
      return c.json(likeJson(state), 200);
    })
    .openapi(commentLikeRoute("delete"), async (c) => {
      const caller = c.get("actor");
      const { slug, commentId } = c.req.valid("param");
      const state = await getDeps().posts.toggleLike(caller, await communityId(caller, slug), {
        subjectType: "comment",
        subjectId: commentId,
        liked: false,
      });
      return c.json(likeJson(state), 200);
    })
    .openapi(uploadPostImage, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const { file } = c.req.valid("form");
      const uploaded = await getDeps().posts.uploadPostImage(caller, id, {
        bytes: new Uint8Array(await file.arrayBuffer()),
        declaredType: file.type,
      });
      return c.json(uploaded, 201);
    })
    .route("/", createScheduledPostsRoutes(getDeps))
    .route("/", createPostFollowRoutes(getDeps));
}
