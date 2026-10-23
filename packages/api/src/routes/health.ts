import { createRoute, z } from "@hono/zod-openapi";

import { createRouter } from "../create-router";
import type { Readiness } from "../readiness";
import { routeMeta } from "../route-meta";

export const healthResponseSchema = z
  .object({
    status: z.enum(["ok", "degraded"]),
    checks: z.object({
      config: z.enum(["ok", "missing"]),
      database: z.enum(["ok", "unreachable", "skipped"]),
    }),
  })
  .openapi("Health");

export const livenessResponseSchema = z
  .object({
    status: z.literal("ok"),
  })
  .openapi("Liveness");

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  operationId: "getHealth",
  "x-cohory": routeMeta("getHealth"),
  tags: ["System"],
  summary: "Check that the app can serve requests",
  description:
    "Readiness: checks that the required configuration is present and that the database answers. Use it for load balancers and the Compose healthcheck.",
  responses: {
    200: {
      description: "The configuration is complete and the database answers.",
      content: { "application/json": { schema: healthResponseSchema } },
    },
    503: {
      description: "Required configuration is missing or the database is unreachable.",
      content: { "application/json": { schema: healthResponseSchema } },
    },
  },
});

const livenessRoute = createRoute({
  method: "get",
  path: "/health/live",
  operationId: "getLiveness",
  "x-cohory": routeMeta("getLiveness"),
  tags: ["System"],
  summary: "Check that the API process is up",
  description: "Liveness: answers as soon as the process runs, without touching the database.",
  responses: {
    200: {
      description: "The API process is running.",
      content: { "application/json": { schema: livenessResponseSchema } },
    },
  },
});

export function createHealthRoutes(readiness: () => Readiness) {
  return createRouter()
    .openapi(livenessRoute, (c) => c.json({ status: "ok" as const }, 200))
    .openapi(healthRoute, async (c) => {
      const report = await readiness()();
      return report.status === "ok" ? c.json(report, 200) : c.json(report, 503);
    });
}
