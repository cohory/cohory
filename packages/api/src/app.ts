import { OpenAPIHono } from "@hono/zod-openapi";
import { approvalActions } from "@cohory/authz";
import { parseAppUrl } from "@cohory/config/platform";
import { logger } from "@cohory/infra/logger";

import {
  createApprovalGateway,
  isSchemaParser,
  type ApprovalGateway,
  type RouteRequestSchemas,
} from "./approvals/gateway";
import { movedCommunityLocation } from "./moved-community";
import { createReplay, replaySessionResolver, type ReplayTarget } from "./approvals/replay";
import { errorJson, errorResponseSchema, toApiError } from "./errors";
import { defaultReadiness, type Readiness } from "./readiness";
import {
  bearerAuth,
  sessionAuditSource,
  type RouteEntry,
  type RouteLookup,
  type TokenAuthDeps,
} from "./middleware/bearer";
import { type SessionResolver } from "./middleware/session";
import { apiDeps } from "./services";
import { cohoryExtension, type CohoryRouteExtension } from "./route-meta";
import { createAgentAccessRoutes, type AgentAccessRouteDeps } from "./routes/agent-access";
import { createAgentDeliveryRoutes } from "./routes/agent-delivery";
import { createAgentsRoutes, type AgentsRouteDeps } from "./routes/agents";
import {
  approvalPendingSchema,
  createApprovalsRoutes,
  type ApprovalsRouteDeps,
} from "./routes/approvals";
import { createAuditLogRoutes } from "./routes/audit-log";
import { createCalendarRoutes, type CalendarRouteDeps } from "./routes/calendar";
import { createCompsRoutes } from "./routes/comps";
import { createJoinRequestRoutes } from "./routes/join-requests";
import { createCommunitiesRoutes, type CommunitiesRouteDeps } from "./routes/communities";
import { createCoursesRoutes, type CoursesRouteDeps } from "./routes/courses";
import { createHealthRoutes } from "./routes/health";
import { createManageRoutes, type ManageRouteDeps } from "./routes/manage";
import { createMembersRoutes, type MembersRouteDeps } from "./routes/members";
import { createMigrationRoutes, type MigrationRouteDeps } from "./routes/migration";
import { createMigrationImporterRoutes } from "./routes/migration-importers";
import { createModerationRoutes, type ModerationRouteDeps } from "./routes/moderation";
import {
  createNotificationPreferencesRoutes,
  type NotificationPreferencesRouteDeps,
} from "./routes/notification-preferences";
import { createNotificationsRoutes, type NotificationsRouteDeps } from "./routes/notifications";
import { createPaymentsRoutes, type PaymentsRouteDeps } from "./routes/payments";
import { createPaymentsLinkingRoutes } from "./routes/payments-linking";
import {
  createPlatformBillingRoutes,
  type PlatformBillingRouteDeps,
} from "./routes/platform-billing";
import { createPostsRoutes, type PostsRouteDeps } from "./routes/posts";
import { createReviewsRoutes, type ReviewsRouteDeps } from "./routes/reviews";
import { createSearchRoutes, type SearchRouteDeps } from "./routes/search";
import { createWebhooksRoutes, type WebhooksRouteDeps } from "./routes/webhooks";

export const openApiInfo = {
  title: "Cohory API",
  version: "0.13.0",
  description: "HTTP API for Cohory communities.",
} as const;

export const sessionCookieName = "better-auth.session_token";

export type ApiDeps = CommunitiesRouteDeps &
  PostsRouteDeps &
  NotificationsRouteDeps &
  NotificationPreferencesRouteDeps &
  MembersRouteDeps &
  CoursesRouteDeps &
  CalendarRouteDeps &
  ManageRouteDeps &
  ModerationRouteDeps &
  ReviewsRouteDeps &
  SearchRouteDeps &
  MigrationRouteDeps &
  PaymentsRouteDeps &
  PlatformBillingRouteDeps &
  WebhooksRouteDeps &
  AgentsRouteDeps &
  ApprovalsRouteDeps &
  AgentAccessRouteDeps;

export interface CreateApiOptions {
  readonly internal?: boolean;
  readonly readiness?: Readiness;
}

function openApiPath(honoPath: string): string {
  return honoPath.replace(/:([A-Za-z0-9_]+)(\{[^}]*\})?/g, "{$1}");
}

function requestSchemas(request: unknown): RouteRequestSchemas {
  if (!request || typeof request !== "object") {
    return { multipart: false };
  }
  const parts: Record<string, unknown> = { ...request };
  const body = parts.body;
  const content =
    body && typeof body === "object" && "content" in body && body.content
      ? (body.content as Record<string, { schema?: unknown } | undefined>)
      : {};
  const json = content["application/json"]?.schema;
  return {
    ...(isSchemaParser(parts.params) ? { params: parts.params } : {}),
    ...(isSchemaParser(parts.query) ? { query: parts.query } : {}),
    ...(isSchemaParser(json) ? { json } : {}),
    multipart: "multipart/form-data" in content,
  };
}

export interface OperationEntry extends RouteEntry {
  readonly method: string;
  readonly path: string;
}

export function operationEntries(app: Pick<OpenAPIHono, "openAPIRegistry">): OperationEntry[] {
  const entries: OperationEntry[] = [];
  for (const definition of app.openAPIRegistry.definitions) {
    if (definition.type !== "route") continue;
    const meta: unknown = definition.route[cohoryExtension];
    if (meta && typeof meta === "object" && "operationId" in meta) {
      entries.push({
        method: definition.route.method.toUpperCase(),
        path: definition.route.path,
        meta: meta as CohoryRouteExtension,
        request: requestSchemas(definition.route.request),
      });
    }
  }
  return entries;
}

function routeLookup(app: OpenAPIHono): RouteLookup {
  let table: Map<string, RouteEntry> | undefined;
  return (method, honoPath) => {
    if (!table) {
      table = new Map(
        operationEntries(app).map((entry) => [`${entry.method} ${entry.path}`, entry]),
      );
    }
    return table.get(`${method} ${openApiPath(honoPath.replace(/^\/api(?=\/)/, ""))}`) ?? null;
  };
}

function documentApprovalResponses(app: OpenAPIHono): void {
  for (const definition of app.openAPIRegistry.definitions) {
    if (definition.type !== "route") continue;
    const meta: unknown = definition.route[cohoryExtension];
    if (!meta || typeof meta !== "object" || !("action" in meta)) continue;
    const action = (meta as CohoryRouteExtension).action;
    if (!action || !approvalActions[action]) continue;
    definition.route.responses[202] ??= {
      description:
        "Agent tokens with proposals:write: an approval request was created and nothing changed yet.",
      content: { "application/json": { schema: approvalPendingSchema } },
    };
    definition.route.responses[429] ??= {
      description: "The agent already has 20 approval requests waiting.",
      content: { "application/json": { schema: errorResponseSchema } },
    };
  }
}

function documentBodyLimitResponses(app: OpenAPIHono): void {
  for (const definition of app.openAPIRegistry.definitions) {
    if (definition.type !== "route" || !definition.route.request?.body) continue;
    definition.route.responses[413] ??= {
      description: "The request body is larger than this operation accepts.",
      content: { "application/json": { schema: errorResponseSchema } },
    };
  }
}

const communitySlugPath = /^(\/api)?\/v1\/communities\/\{slug\}/;

function documentInputResponses(app: OpenAPIHono): void {
  for (const definition of app.openAPIRegistry.definitions) {
    if (definition.type !== "route") continue;
    const { request, responses } = definition.route;
    if (request?.params || request?.query || request?.body) {
      responses[422] ??= {
        description: "A path parameter, query parameter, or body field is not valid.",
        content: { "application/json": { schema: errorResponseSchema } },
      };
    }
    if (communitySlugPath.test(openApiPath(definition.route.path))) {
      responses[308] ??= {
        description:
          "The community changed its URL. Location holds the same request under the new slug.",
        headers: {
          Location: {
            description: "The same request under the new slug.",
            schema: { type: "string" },
          },
        },
      };
    }
  }
}

// A proxy instead of a spread, so services that are built on first use stay unbuilt.
function withSessionResolver(deps: ApiDeps, resolveSession: SessionResolver): ApiDeps {
  return new Proxy(deps, {
    get: (target, key, receiver) =>
      key === "resolveSession" ? resolveSession : Reflect.get(target, key, receiver),
  });
}

const gateways = new WeakMap<object, ApprovalGateway>();

export function approvalGatewayOf(app: object): ApprovalGateway {
  const gateway = gateways.get(app);
  if (!gateway) {
    throw new Error("not an api created by createApi");
  }
  return gateway;
}

export function createApi(getDeps: () => ApiDeps, options: CreateApiOptions = {}) {
  let internal: ReplayTarget | undefined;
  const replay = createReplay(() => {
    internal ??= createApi(() => withSessionResolver(getDeps(), replaySessionResolver), {
      internal: true,
    });
    return internal;
  });
  const gateway = createApprovalGateway({
    approvals: () => getDeps().approvals,
    replay,
  });
  const v1 = new OpenAPIHono()
    .route(
      "/",
      createHealthRoutes(() => options.readiness ?? defaultReadiness),
    )
    .route("/", createAgentsRoutes(getDeps))
    .route(
      "/",
      createApprovalsRoutes(getDeps, () => gateway),
    )
    .route(
      "/",
      createAgentAccessRoutes(getDeps, () => gateway),
    )
    .route("/", createAgentDeliveryRoutes(getDeps))
    .route("/", createCommunitiesRoutes(getDeps))
    .route("/", createPostsRoutes(getDeps))
    .route("/", createNotificationsRoutes(getDeps))
    .route("/", createNotificationPreferencesRoutes(getDeps))
    .route("/", createMembersRoutes(getDeps))
    .route("/", createCoursesRoutes(getDeps))
    .route("/", createCalendarRoutes(getDeps))
    .route("/", createManageRoutes(getDeps))
    .route("/", createModerationRoutes(getDeps))
    .route("/", createReviewsRoutes(getDeps))
    .route("/", createAuditLogRoutes(getDeps))
    .route("/", createJoinRequestRoutes(getDeps))
    .route("/", createSearchRoutes(getDeps))
    .route("/", createCompsRoutes(getDeps))
    .route("/", createMigrationRoutes(getDeps))
    .route("/", createMigrationImporterRoutes(getDeps))
    .route("/", createPlatformBillingRoutes(getDeps))
    .route("/", createPaymentsRoutes(getDeps))
    .route("/", createPaymentsLinkingRoutes(getDeps))
    .route("/", createWebhooksRoutes(getDeps));
  const app = new OpenAPIHono().basePath("/api");
  const tokenDeps = (): TokenAuthDeps => {
    const deps = getDeps();
    return {
      agents: deps.agents,
      rateLimiter: deps.rateLimiter,
    };
  };
  if (!options.internal) {
    app.use(
      "/v1/*",
      sessionAuditSource(),
      bearerAuth(tokenDeps, routeLookup(app), () => gateway),
    );
  }
  app.route("/v1", v1);
  documentApprovalResponses(app);
  documentBodyLimitResponses(app);
  documentInputResponses(app);

  app.openAPIRegistry.registerComponent("securitySchemes", "bearerToken", {
    type: "http",
    scheme: "bearer",
    description:
      "A personal or agent API token (cohory_ followed by 43 characters). Each operation lists the scope it needs in x-cohory.scope; operations with a null scope need a session.",
  });

  app.openAPIRegistry.registerComponent("securitySchemes", "sessionCookie", {
    type: "apiKey",
    in: "cookie",
    name: sessionCookieName,
    description: "Better Auth session cookie set by /api/auth sign in.",
  });

  app.onError(async (error, c) => {
    const moved = await movedCommunityLocation(error, c.req.url, getDeps().communities);
    if (moved) {
      return c.body(null, 308, { Location: moved });
    }
    const apiError = toApiError(error);
    if (apiError.status === 500) {
      logger.error({ name: error.name }, "unhandled api error");
    }
    return errorJson(c, apiError);
  });
  app.notFound((c) =>
    errorJson(c, { status: 404, code: "not_found", message: "We could not find that page." }),
  );
  let openApiJson: string | undefined;
  app.get("/openapi.json", (c) => {
    openApiJson ??= JSON.stringify(createOpenApiDocument(app));
    return c.body(openApiJson, 200, { "Content-Type": "application/json" });
  });
  gateways.set(app, gateway);
  return app;
}

export type Api = ReturnType<typeof createApi>;

const defaultDeps = apiDeps();

export const api = createApi(() => defaultDeps);

export function getApprovalGateway(): ApprovalGateway {
  return approvalGatewayOf(api);
}

type OpenApiDocument = ReturnType<Api["getOpenAPI31Document"]>;

const documents = new WeakMap<Api, OpenApiDocument>();

export function createOpenApiDocument(app: Api = api): OpenApiDocument {
  let document = documents.get(app);
  if (!document) {
    document = app.getOpenAPI31Document({
      openapi: "3.1.0",
      info: openApiInfo,
      servers: [{ url: parseAppUrl(), description: "This Cohory server" }],
    });
    documents.set(app, document);
  }
  return document;
}
