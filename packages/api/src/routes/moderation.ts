import { createRoute, z } from "@hono/zod-openapi";
import type { Actor } from "@cohory/authz";
import { type CommunitiesService, type ManageService } from "@cohory/communities";
import {
  reportReasons,
  type PostsService,
  type ReportGroupView,
  type ReportQueue,
} from "@cohory/posts";
import { reportNoteMaxLength } from "@cohory/db/schema";
import { bodyLimit } from "hono/body-limit";

import { pageCursor } from "../pagination";
import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { resolveActor, type SessionResolver } from "../middleware/session";
import {
  commentParams,
  errorResponse,
  json,
  postParams,
  slugParams,
  tooManyRequests,
} from "./posts-schemas";

const jsonLimit = bodyLimit({ maxSize: 16 * 1024 });

export interface ModerationRouteDeps {
  resolveSession: SessionResolver;
  communities: CommunitiesService;
  posts: PostsService;
  manage: ManageService;
}

const security = [{ sessionCookie: [] }];
const errors = {
  401: errorResponse("Sign in required."),
  403: errorResponse("The caller is not allowed to do this in the community."),
  404: errorResponse("The community, post, or comment does not exist or is not visible."),
  422: errorResponse("The input is invalid."),
};
const staff = " Moderators, admins, and owners.";

const reportBodySchema = z
  .object({
    reason: z.enum(reportReasons).openapi({ description: "Why the content is reported." }),
    note: z.string().max(reportNoteMaxLength).optional().openapi({
      description: "Optional context for the moderators. Reporters stay anonymous to them.",
    }),
  })
  .openapi("ReportInput");

const receiptSchema = z.object({ status: z.literal("received") }).openapi("ReportReceipt");

const targetBodySchema = z
  .object({ type: z.enum(["post", "comment"]), id: z.uuid() })
  .openapi("ReportTarget");

const resolutionSchema = z.object({ resolved: z.int() }).openapi("ReportResolution");

const reportGroupSchema = z
  .object({
    content: z.object({
      type: z.enum(["post", "comment"]),
      id: z.uuid(),
      postId: z.uuid(),
      postTitle: z.string().nullable(),
      excerpt: z.string(),
      author: z.object({
        id: z.uuid(),
        name: z.string(),
        role: z.enum(["member", "moderator", "admin", "owner"]).nullable().openapi({
          description:
            "The author's current role, or null when they are no longer an active member.",
        }),
      }),
      deletedAt: z.iso.datetime().nullable(),
    }),
    status: z.enum(["open", "dismissed", "content_removed", "member_banned"]),
    reportCount: z.int(),
    reasons: z.array(z.enum(reportReasons)),
    notes: z.array(z.string()),
    firstReportedAt: z.iso.datetime(),
    lastReportedAt: z.iso.datetime(),
    resolvedAt: z.iso.datetime().nullable(),
    resolvedBy: z.string().nullable(),
  })
  .openapi("ReportGroup");

const queueSchema = z
  .object({ data: z.array(reportGroupSchema), ...pageCursor, openCount: z.int() })
  .openapi("ReportQueue");

const queueQuerySchema = z.object({
  status: z
    .enum(["open", "closed"])
    .optional()
    .openapi({
      param: { name: "status", in: "query" },
      description: "open (default) or closed reports.",
    }),
});

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function groupJson(group: ReportGroupView): z.infer<typeof reportGroupSchema> {
  return {
    ...group,
    content: { ...group.content, deletedAt: iso(group.content.deletedAt) },
    reasons: [...group.reasons],
    notes: [...group.notes],
    firstReportedAt: group.firstReportedAt.toISOString(),
    lastReportedAt: group.lastReportedAt.toISOString(),
    resolvedAt: iso(group.resolvedAt),
  };
}

function queueJson(queue: ReportQueue): z.infer<typeof queueSchema> {
  return { data: queue.data.map(groupJson), nextCursor: null, openCount: queue.openCount };
}

function reportDetails(kind: "post" | "comment") {
  return {
    method: "post" as const,
    operationId: kind === "post" ? "reportPost" : "reportComment",
    "x-cohory": routeMeta(kind === "post" ? "reportPost" : "reportComment"),
    tags: ["Moderation"],
    security,
    summary: `Report a ${kind}`,
    description: `Flags the ${kind} for the moderators. Reporting the same ${kind} again while the report is open changes nothing. You cannot report your own content. Rate limited per member (RATE_LIMIT_REPORTS).`,
    responses: {
      200: json(receiptSchema, "The report was received."),
      429: tooManyRequests,
      ...errors,
    },
  };
}

const reportBody = {
  body: { required: true, content: { "application/json": { schema: reportBodySchema } } },
};

const reportPost = createRoute({
  ...reportDetails("post"),
  path: "/communities/{slug}/posts/{postId}/report",
  middleware: [jsonLimit] as const,
  request: { params: postParams, ...reportBody },
});

const reportComment = createRoute({
  ...reportDetails("comment"),
  path: "/communities/{slug}/comments/{commentId}/report",
  middleware: [jsonLimit] as const,
  request: { params: commentParams, ...reportBody },
});

const listReports = createRoute({
  method: "get",
  path: "/communities/{slug}/manage/reports",
  operationId: "listReports",
  "x-cohory": routeMeta("listReports"),
  tags: ["Moderation"],
  security,
  summary: "List reported content",
  description: `Reported posts and comments grouped per item, newest report first, up to 50. Each group has the number of reports, the reasons, up to three notes, and for closed groups who resolved them and when.${staff}`,
  request: { params: slugParams, query: queueQuerySchema },
  responses: { 200: json(queueSchema, "The moderation queue."), ...errors },
});

function resolveRoute(action: "dismiss" | "ban") {
  return createRoute({
    method: "post",
    path: `/communities/{slug}/manage/reports/${action}`,
    operationId: action === "dismiss" ? "dismissReports" : "banReportedAuthor",
    "x-cohory": routeMeta(action === "dismiss" ? "dismissReports" : "banReportedAuthor"),
    tags: ["Moderation"],
    security,
    summary: action === "dismiss" ? "Dismiss reports" : "Ban the author of reported content",
    description:
      action === "dismiss"
        ? `Closes the open reports on one post or comment without changing it. Written to the audit log.${staff}`
        : `Bans the author with the same rules as the ban route in Manage, then closes the open reports on the item. To remove the content, delete the post or comment; that closes its reports too.${staff}`,
    middleware: [jsonLimit] as const,
    request: {
      params: slugParams,
      body: { required: true, content: { "application/json": { schema: targetBodySchema } } },
    },
    responses: { 200: json(resolutionSchema, "The number of reports closed."), ...errors },
  });
}

export function createModerationRoutes(getDeps: () => ModerationRouteDeps) {
  const app = createRouter();
  const actor = resolveActor(() => getDeps().resolveSession);
  app.use("/communities/:slug/posts/:postId/report", actor);
  app.use("/communities/:slug/comments/:commentId/report", actor);
  app.use("/communities/:slug/manage/reports", actor);
  app.use("/communities/:slug/manage/reports/*", actor);

  const manage = () => getDeps().manage;

  async function communityId(caller: Actor, slug: string): Promise<string> {
    return (await getDeps().communities.getCommunityBySlug(caller, slug)).id;
  }

  return app
    .openapi(reportPost, async (c) => {
      const caller = c.get("actor");
      const { slug, postId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(await getDeps().posts.reportPost(caller, id, postId, c.req.valid("json")), 200);
    })
    .openapi(reportComment, async (c) => {
      const caller = c.get("actor");
      const { slug, commentId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const receipt = await getDeps().posts.reportComment(
        caller,
        id,
        commentId,
        c.req.valid("json"),
      );
      return c.json(receipt, 200);
    })
    .openapi(listReports, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const queue = await getDeps().posts.listReports(caller, id, c.req.valid("query"));
      return c.json(queueJson(queue), 200);
    })
    .openapi(resolveRoute("dismiss"), async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      return c.json(await getDeps().posts.dismissReports(caller, id, c.req.valid("json")), 200);
    })
    .openapi(resolveRoute("ban"), async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const result = await getDeps().posts.resolveReportsWithBan(
        caller,
        id,
        c.req.valid("json"),
        async (authorId) => {
          await manage().banMember(caller, id, authorId);
        },
      );
      return c.json(result, 200);
    });
}
