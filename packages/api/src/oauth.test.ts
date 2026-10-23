import { OAuthError, oauthIssuer, type OAuthService } from "@cohory/agents/oauth";
import { authorizationServerMetadata, protectedResourceMetadata } from "@cohory/agents/oauth";
import { createRateLimiter, rateLimitDefaults, type RateLimitRules } from "@cohory/rate-limit";
import { describe, expect, it, vi } from "vitest";

import { createOAuthApp } from "./oauth";

const issuer = oauthIssuer("https://learn.example.com");

function setup(rules: Partial<RateLimitRules> = {}) {
  const oauth = {
    protectedResourceMetadata: () => protectedResourceMetadata(issuer),
    authorizationServerMetadata: () => authorizationServerMetadata(issuer),
    register: vi.fn<OAuthService["register"]>(async () => ({
      client_id: "c",
      client_id_issued_at: 1,
      client_name: "App",
      redirect_uris: ["https://app.example.com/cb"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none" as const,
    })),
    token: vi.fn<OAuthService["token"]>(async () => ({
      access_token: "cohory_x",
      token_type: "Bearer" as const,
      expires_in: 3600,
      refresh_token: "cohoryrt_x",
      scope: "posts:read",
    })),
    revoke: vi.fn<OAuthService["revoke"]>(async () => undefined),
  };
  const rateLimiter = createRateLimiter({ rules: { ...rateLimitDefaults, ...rules } });
  return { app: createOAuthApp(() => ({ oauth, rateLimiter })), oauth };
}

function form(fields: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "10.0.0.1" },
    body: new URLSearchParams(fields).toString(),
  };
}

describe("oauth discovery", () => {
  it.each(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"])(
    "serves protected resource metadata at %s with CORS",
    async (path) => {
      const response = await setup().app.request(path, { headers: { origin: "https://x.test" } });
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(await response.json()).toMatchObject({
        resource: "https://learn.example.com/mcp",
        authorization_servers: ["https://learn.example.com"],
      });
    },
  );

  it("serves authorization server metadata", async () => {
    const response = await setup().app.request("/.well-known/oauth-authorization-server");
    expect(await response.json()).toMatchObject({
      issuer: "https://learn.example.com",
      code_challenge_methods_supported: ["S256"],
    });
  });
});

describe("oauth endpoints", () => {
  it("registers clients from JSON and answers 201", async () => {
    const { app, oauth } = setup();
    const response = await app.request("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://app.example.com/cb"] }),
    });
    expect(response.status).toBe(201);
    expect(oauth.register).toHaveBeenCalledWith({ redirect_uris: ["https://app.example.com/cb"] });
  });

  it("refuses bodies over 16 KB with 413 before reading them", async () => {
    const { app, oauth } = setup();
    const big = "x".repeat(17 * 1024);
    const register = await app.request("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: big }),
    });
    const token = await app.request("/oauth/token", form({ grant_type: big }));
    const revoke = await app.request("/oauth/revoke", form({ token: big }));

    expect([register.status, token.status, revoke.status]).toEqual([413, 413, 413]);
    expect(await register.json()).toMatchObject({ error: "invalid_request" });
    expect(oauth.register).not.toHaveBeenCalled();
    expect(oauth.token).not.toHaveBeenCalled();
    expect(oauth.revoke).not.toHaveBeenCalled();
  });

  it("maps registration errors to RFC 7591 error bodies", async () => {
    const { app, oauth } = setup();
    oauth.register.mockRejectedValueOnce(new OAuthError("invalid_redirect_uri", "bad"));
    const response = await app.request("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_redirect_uri",
      error_description: "bad",
    });
  });

  it("requires a form body on the token endpoint and never caches tokens", async () => {
    const { app, oauth } = setup();
    const json = await app.request("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(json.status).toBe(400);
    const ok = await app.request("/oauth/token", form({ grant_type: "refresh_token" }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(oauth.token).toHaveBeenCalledWith({ grant_type: "refresh_token" });
  });

  it("answers 401 for unknown clients", async () => {
    const { app, oauth } = setup();
    oauth.token.mockRejectedValueOnce(new OAuthError("invalid_client", "Unknown client_id"));
    const response = await app.request("/oauth/token", form({ client_id: "x" }));
    expect(response.status).toBe(401);
  });

  it("answers 200 on revoke", async () => {
    const response = await setup().app.request(
      "/oauth/revoke",
      form({ token: "t", client_id: "c" }),
    );
    expect(response.status).toBe(200);
  });

  it("rate limits registration per client address", async () => {
    const { app } = setup({ oauthRegister: { max: 2, windowSeconds: 3600 } });
    const register = () =>
      app.request("/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.9" },
        body: JSON.stringify({ redirect_uris: ["https://app.example.com/cb"] }),
      });
    expect((await register()).status).toBe(201);
    expect((await register()).status).toBe(201);
    const third = await register();
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).not.toBeNull();
  });

  it("rate limits the token endpoint per client address", async () => {
    const { app } = setup({ oauthToken: { max: 1, windowSeconds: 60 } });
    expect((await app.request("/oauth/token", form({}))).status).toBe(200);
    expect((await app.request("/oauth/token", form({}))).status).toBe(429);
    expect((await app.request("/oauth/revoke", form({ token: "t" }))).status).toBe(429);
  });
});
