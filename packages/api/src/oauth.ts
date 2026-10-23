import { getOAuthService, OAuthError, type OAuthService } from "@cohory/agents/oauth";
import {
  clientIp,
  getRateLimiter,
  type RateLimiter,
  type RateLimitRuleName,
} from "@cohory/rate-limit";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "@cohory/infra/logger";

export interface OAuthRouteDeps {
  readonly oauth: Pick<
    OAuthService,
    "protectedResourceMetadata" | "authorizationServerMetadata" | "register" | "token" | "revoke"
  >;
  readonly rateLimiter: RateLimiter;
}

function oauthError(c: Context, error: OAuthError): Response {
  c.header("Cache-Control", "no-store");
  return c.json(error.toJSON(), error.status === 401 ? 401 : error.status === 403 ? 403 : 400);
}

function limited(c: Context, rateLimiter: RateLimiter, rule: RateLimitRuleName): Response | null {
  const take = rateLimiter.take(rule, `ip:${clientIp(c.req.raw.headers)}`);
  if (take.allowed) {
    return null;
  }
  c.header("Retry-After", String(take.retryAfterSeconds));
  c.header("Cache-Control", "no-store");
  return c.json(
    { error: "slow_down", error_description: "Too many requests. Wait a moment and try again." },
    429,
  );
}

async function formBody(c: Context): Promise<Record<string, string> | null> {
  const type = c.req.header("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return null;
  }
  const body = await c.req.parseBody();
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  return fields;
}

async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

export function createOAuthApp(getDeps: () => OAuthRouteDeps) {
  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "MCP-Protocol-Version"],
      maxAge: 600,
    }),
  );

  const resourceMetadata = (c: Context) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json(getDeps().oauth.protectedResourceMetadata());
  };
  app.get("/.well-known/oauth-protected-resource", resourceMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp", resourceMetadata);
  app.get("/.well-known/oauth-authorization-server", (c) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json(getDeps().oauth.authorizationServerMetadata());
  });

  app.use("/oauth/*", bodyLimit({ maxSize: 16 * 1024 }));

  app.post("/oauth/register", async (c) => {
    const deps = getDeps();
    const refused = limited(c, deps.rateLimiter, "oauthRegister");
    if (refused) return refused;
    const body = await jsonBody(c);
    if (body === null || typeof body !== "object") {
      return oauthError(
        c,
        new OAuthError("invalid_client_metadata", "Send client metadata as JSON"),
      );
    }
    try {
      const registered = await deps.oauth.register(body);
      c.header("Cache-Control", "no-store");
      return c.json(registered, 201);
    } catch (error: unknown) {
      if (error instanceof OAuthError) return oauthError(c, error);
      throw error;
    }
  });

  app.post("/oauth/token", async (c) => {
    const deps = getDeps();
    const refused = limited(c, deps.rateLimiter, "oauthToken");
    if (refused) return refused;
    const body = await formBody(c);
    if (!body) {
      return oauthError(
        c,
        new OAuthError(
          "invalid_request",
          "Send the token request as application/x-www-form-urlencoded",
        ),
      );
    }
    try {
      const tokens = await deps.oauth.token(body);
      c.header("Cache-Control", "no-store");
      c.header("Pragma", "no-cache");
      return c.json(tokens);
    } catch (error: unknown) {
      if (error instanceof OAuthError) return oauthError(c, error);
      throw error;
    }
  });

  app.post("/oauth/revoke", async (c) => {
    const deps = getDeps();
    const refused = limited(c, deps.rateLimiter, "oauthToken");
    if (refused) return refused;
    const body = await formBody(c);
    if (!body) {
      return oauthError(
        c,
        new OAuthError(
          "invalid_request",
          "Send the revocation request as application/x-www-form-urlencoded",
        ),
      );
    }
    try {
      await deps.oauth.revoke(body);
      c.header("Cache-Control", "no-store");
      return c.body(null, 200);
    } catch (error: unknown) {
      if (error instanceof OAuthError) return oauthError(c, error);
      throw error;
    }
  });

  app.onError((error, c) => {
    c.header("Cache-Control", "no-store");
    if (error instanceof HTTPException && error.status === 413) {
      return c.json(
        { error: "invalid_request", error_description: "The request body is too large." },
        413,
      );
    }
    logger.error({ name: error.name }, "unhandled oauth error");
    return c.json({ error: "server_error", error_description: "Something went wrong." }, 500);
  });
  app.notFound((c) => c.json({ error: "not_found", error_description: "Not found." }, 404));
  return app;
}

export const oauthApp = createOAuthApp(() => ({
  oauth: getOAuthService(),
  rateLimiter: getRateLimiter(),
}));
