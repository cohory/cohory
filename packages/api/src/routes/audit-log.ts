import { createRoute, z } from "@hono/zod-openapi";
import type { Actor } from "@cohory/authz";
import {
  auditCsvMaxRows,
  type AuditEntryView,
  type CommunitiesService,
  type ManageService,
} from "@cohory/communities";

import { cursorPage, cursorQuery } from "../pagination";
import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { resolveActor, type SessionResolver } from "../middleware/session";
import { errorResponse, json, slugParams } from "./posts-schemas";

export interface AuditLogRouteDeps {
  resolveSession: SessionResolver;
  communities: CommunitiesService;
  manage: ManageService;
}

const security = [{ sessionCookie: [] }];
const tags = ["Manage"];
const errors = {
  401: errorResponse("Sign in required."),
  403: errorResponse("The caller is not allowed to do this in the community."),
  404: errorResponse("The community does not exist or is not visible to the caller."),
  422: errorResponse("The input is invalid."),
};

const day = (name: string, description: string) =>
  z.iso
    .date()
    .optional()
    .openapi({ param: { name, in: "query" }, description, example: "2026-10-18" });

const filterQuery = {
  action: z
    .string()
    .max(64)
    .optional()
    .openapi({
      param: { name: "action", in: "query" },
      description: "One action, for example member.banned.",
    }),
  actorType: z
    .enum(["user", "agent", "system"])
    .optional()
    .openapi({
      param: { name: "actorType", in: "query" },
      description: "Only entries by people, by agents, or by the system.",
    }),
  via: z
    .enum(["web", "api", "mcp", "job"])
    .optional()
    .openapi({
      param: { name: "via", in: "query" },
      description:
        "Only entries made in the web app, through an API token, through MCP, or by a job.",
    }),
  agentId: z
    .uuid()
    .optional()
    .openapi({ param: { name: "agentId", in: "query" }, description: "Only one agent's entries." }),
  tokenId: z
    .uuid()
    .optional()
    .openapi({
      param: { name: "tokenId", in: "query" },
      description: "Only entries made with one API token.",
    }),
  from: day("from", "First day to include (UTC)."),
  to: day("to", "Last day to include (UTC)."),
};

const listQuerySchema = z.object({
  ...filterQuery,
  ...cursorQuery({ max: 100, example: 50 }),
});

const entrySchema = z
  .object({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    actor: z
      .object({ id: z.uuid(), name: z.string() })
      .nullable()
      .openapi({ description: "The person, or for agent entries the agent's owning human." }),
    actorType: z.enum(["user", "agent", "system"]).nullable(),
    via: z.enum(["web", "api", "mcp", "job"]).nullable(),
    tokenId: z.uuid().nullable(),
    agent: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    action: z.string(),
    target: z.string().nullable(),
    targetName: z
      .string()
      .nullable()
      .openapi({ description: "The person's name when the target is a user id." }),
    metadata: z.record(z.string(), z.unknown()).nullable(),
  })
  .openapi("AuditEntry");

const pageSchema = cursorPage(entrySchema)
  .extend({
    actions: z
      .array(z.string())
      .openapi({ description: "Every action recorded in the community." }),
  })
  .openapi("AuditLogPage");

function entryJson(entry: AuditEntryView): z.infer<typeof entrySchema> {
  return {
    ...entry,
    createdAt: entry.createdAt.toISOString(),
    metadata: entry.metadata ? { ...entry.metadata } : null,
  };
}

const listAuditLog = createRoute({
  method: "get",
  path: "/communities/{slug}/manage/audit-log",
  operationId: "listAuditLog",
  "x-cohory": routeMeta("listAuditLog"),
  tags,
  security,
  summary: "List the audit log",
  description:
    "Admin actions newest first: role changes, bans, removals, invites, join decisions, settings, exports, payment settings, report decisions, point resets, and comped access. Filter by action and by UTC day. Admins and owners only.",
  request: { params: slugParams, query: listQuerySchema },
  responses: { 200: json(pageSchema, "A page of audit entries."), ...errors },
});

const exportAuditLog = createRoute({
  method: "get",
  path: "/communities/{slug}/manage/audit-log.csv",
  operationId: "exportAuditLogCsv",
  "x-cohory": routeMeta("exportAuditLogCsv"),
  tags,
  security,
  summary: "Export the audit log as CSV",
  description: `UTF-8 CSV with a byte order mark, newest first, with the same filters as the list. Columns: created_at, actor, actor_id, actor_type, via, token_id, agent_id, agent_name, action, target, target_name, metadata (JSON). Up to ${auditCsvMaxRows} rows; the X-Truncated header is true when more matched. Every export is written to the audit log. Owner only.`,
  request: { params: slugParams, query: z.object(filterQuery) },
  responses: {
    200: {
      description: "The CSV file.",
      content: { "text/csv": { schema: z.string().openapi({ format: "binary" }) } },
    },
    ...errors,
  },
});

export function createAuditLogRoutes(getDeps: () => AuditLogRouteDeps) {
  const app = createRouter();
  const actor = resolveActor(() => getDeps().resolveSession);
  app.use("/communities/:slug/manage/audit-log", actor);
  app.use("/communities/:slug/manage/audit-log.csv", actor);

  const manage = () => getDeps().manage;

  async function communityId(caller: Actor, slug: string): Promise<string> {
    return (await getDeps().communities.getCommunityBySlug(caller, slug)).id;
  }

  return app
    .openapi(listAuditLog, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const page = await manage().listAuditLog(caller, id, c.req.valid("query"));
      return c.json(
        { data: page.data.map(entryJson), nextCursor: page.nextCursor, actions: [...page.actions] },
        200,
      );
    })
    .openapi(exportAuditLog, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const csv = await manage().exportAuditLogCsv(caller, id, c.req.valid("query"));
      return new Response(csv.body, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${csv.filename}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Truncated": String(csv.truncated),
        },
      });
    });
}
