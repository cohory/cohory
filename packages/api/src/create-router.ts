import { OpenAPIHono } from "@hono/zod-openapi";

import { errorJson, validationError } from "./errors";
import type { ActorVariables } from "./middleware/session";
import { issuesOf } from "./validation";

export function createRouter() {
  return new OpenAPIHono<{ Variables: ActorVariables }>({
    defaultHook: (result, c) =>
      result.success ? undefined : errorJson(c, validationError(issuesOf(result.error))),
  });
}
