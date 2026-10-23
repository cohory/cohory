import { grantedScopes } from "@cohory/authz";
import { createRoute, z } from "@hono/zod-openapi";
import { maxSearchLength } from "@cohory/db";
import type { CommunitiesService } from "@cohory/communities";
import { rateLimitKey } from "@cohory/rate-limit";
import { type SearchResults, type SearchService } from "@cohory/search";

import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { resolveActor, type SessionResolver } from "../middleware/session";
import { errorResponse, json, slugParams, tooManyRequests } from "./posts-schemas";

export interface SearchRouteDeps {
  resolveSession: SessionResolver;
  communities: CommunitiesService;
  search: SearchService;
}

const optionalSession: Record<string, string[]>[] = [{}, { sessionCookie: [] }];

const segmentSchema = z.object({ text: z.string(), match: z.boolean() }).openapi("ExcerptSegment");

const resultsSchema = z
  .object({
    query: z.string(),
    posts: z.array(
      z.object({
        postId: z.uuid(),
        commentId: z.uuid().nullable(),
        title: z.string().nullable(),
        excerpt: z.array(segmentSchema),
        authorName: z.string(),
        createdAt: z.iso.datetime(),
      }),
    ),
    members: z.array(
      z.object({
        userId: z.uuid(),
        name: z.string(),
        username: z.string().nullable(),
        image: z.string().nullable(),
        bioExcerpt: z.array(segmentSchema),
      }),
    ),
    lessons: z.array(
      z.object({
        courseSlug: z.string(),
        courseTitle: z.string(),
        lessonSlug: z.string(),
        lessonTitle: z.string(),
        excerpt: z.array(segmentSchema),
      }),
    ),
  })
  .openapi("SearchResults");

const searchQuerySchema = z.object({
  q: z
    .string()
    .max(maxSearchLength)
    .openapi({ param: { name: "q", in: "query" }, example: "pottery wheel" }),
});

function resultsJson(results: SearchResults): z.infer<typeof resultsSchema> {
  return {
    query: results.query,
    posts: results.posts.map((hit) => ({
      postId: hit.postId,
      commentId: hit.commentId,
      title: hit.title,
      excerpt: hit.excerpt.map((segment) => ({ ...segment })),
      authorName: hit.authorName,
      createdAt: hit.createdAt.toISOString(),
    })),
    members: results.members.map((hit) => ({
      ...hit,
      bioExcerpt: hit.bioExcerpt.map((segment) => ({ ...segment })),
    })),
    lessons: results.lessons.map((hit) => ({
      ...hit,
      excerpt: hit.excerpt.map((segment) => ({ ...segment })),
    })),
  };
}

const searchRoute = createRoute({
  method: "get",
  path: "/communities/{slug}/search",
  operationId: "searchCommunity",
  "x-cohory": routeMeta("searchCommunity"),
  tags: ["Communities"],
  security: optionalSession,
  summary: "Search a community",
  description:
    "Postgres full text search over posts and comments, members, and lessons the caller may read, up to 10 hits each, with highlighted excerpts. Needs 2 to 100 characters. Rate limited per member or client address (RATE_LIMIT_SEARCH).",
  request: { params: slugParams, query: searchQuerySchema },
  responses: {
    200: json(resultsSchema, "Search results."),
    403: errorResponse("The caller may not read this community."),
    404: errorResponse("The community does not exist."),
    422: errorResponse("The query is too short or has no words."),
    429: tooManyRequests,
  },
});

export function createSearchRoutes(getDeps: () => SearchRouteDeps) {
  const app = createRouter();
  app.use(
    "/communities/:slug/search",
    resolveActor(() => getDeps().resolveSession),
  );

  const search = () => getDeps().search;

  return app.openapi(searchRoute, async (c) => {
    const caller = c.get("actor");
    const community = await getDeps().communities.getCommunityBySlug(
      caller,
      c.req.valid("param").slug,
    );
    const rateKey = rateLimitKey(caller, c.req.raw.headers);
    const results = await search().search(
      caller,
      community.id,
      { query: c.req.valid("query").q },
      rateKey,
      grantedScopes(caller),
    );
    return c.json(resultsJson(results), 200);
  });
}
