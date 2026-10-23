import { scopes } from "@cohory/authz";
import { describe, expect, it } from "vitest";

import {
  authorizationServerMetadata,
  oauthIssuer,
  protectedResourceMetadata,
  sameResource,
} from "./metadata";
import { isLoopbackRedirect, redirectUriProblem } from "./redirect-uri";
import { parseScopeParam } from "./schemas";
import {
  generateAuthorizationCode,
  generateRefreshToken,
  s256Challenge,
  verifyPkce,
} from "./secrets";

const issuer = oauthIssuer("https://learn.example.com/");

describe("metadata documents", () => {
  it("describes /mcp as the protected resource served by this authorization server", () => {
    expect(protectedResourceMetadata(issuer)).toMatchObject({
      resource: "https://learn.example.com/mcp",
      authorization_servers: ["https://learn.example.com"],
      bearer_methods_supported: ["header"],
    });
  });

  it("advertises the RFC 8414 fields MCP clients rely on", () => {
    const metadata = authorizationServerMetadata(issuer);
    expect(metadata).toMatchObject({
      issuer: "https://learn.example.com",
      authorization_endpoint: "https://learn.example.com/oauth/authorize",
      token_endpoint: "https://learn.example.com/oauth/token",
      registration_endpoint: "https://learn.example.com/oauth/register",
      revocation_endpoint: "https://learn.example.com/oauth/revoke",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
    });
    expect(metadata.scopes_supported).toEqual([...scopes]);
  });

  it("uses the origin of APP_URL as the issuer, without a path", () => {
    expect(oauthIssuer("http://localhost:3000/some/path").issuer).toBe("http://localhost:3000");
  });
});

describe("resource matching", () => {
  it("accepts the canonical /mcp resource with or without a trailing slash and any host case", () => {
    expect(sameResource("https://learn.example.com/mcp", issuer.resource)).toBe(true);
    expect(sameResource("https://learn.example.com/mcp/", issuer.resource)).toBe(true);
    expect(sameResource("HTTPS://LEARN.example.com/mcp", issuer.resource)).toBe(true);
  });

  it("refuses other resources, fragments, and queries", () => {
    expect(sameResource("https://learn.example.com", issuer.resource)).toBe(false);
    expect(sameResource("https://evil.example.com/mcp", issuer.resource)).toBe(false);
    expect(sameResource("https://learn.example.com/mcp#x", issuer.resource)).toBe(false);
    expect(sameResource("https://learn.example.com/mcp?x=1", issuer.resource)).toBe(false);
    expect(sameResource("not a url", issuer.resource)).toBe(false);
  });
});

describe("redirect URIs", () => {
  it("allows https and loopback http", () => {
    expect(redirectUriProblem("https://app.example.com/callback")).toBeNull();
    expect(redirectUriProblem("http://127.0.0.1:33418/callback")).toBeNull();
    expect(redirectUriProblem("http://localhost:6274/oauth/callback")).toBeNull();
    expect(redirectUriProblem("http://[::1]:8080/cb")).toBeNull();
    expect(isLoopbackRedirect("http://127.0.0.1:33418/callback")).toBe(true);
  });

  it("refuses plain http, custom schemes, fragments, and credentials", () => {
    expect(redirectUriProblem("http://app.example.com/callback")).toBe("insecure");
    expect(redirectUriProblem("myapp://callback")).toBe("insecure");
    expect(redirectUriProblem("https://app.example.com/cb#frag")).toBe("fragment");
    expect(redirectUriProblem("https://user:pw@app.example.com/cb")).toBe("credentials");
    expect(redirectUriProblem("/relative")).toBe("not_absolute");
  });
});

describe("PKCE", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

  it("computes the RFC 7636 S256 example challenge", () => {
    expect(s256Challenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("verifies only the matching verifier", () => {
    expect(verifyPkce(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
    expect(verifyPkce(`${verifier}x`, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(false);
    expect(verifyPkce("short", s256Challenge("short"))).toBe(false);
  });
});

describe("secrets", () => {
  it("generates distinct codes and refresh tokens and stores only hashes", () => {
    const a = generateAuthorizationCode();
    const b = generateAuthorizationCode();
    expect(a.value).not.toBe(b.value);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    const refresh = generateRefreshToken();
    expect(refresh.value).toMatch(/^cohoryrt_[A-Za-z0-9_-]{43}$/);
  });
});

describe("scope parameter", () => {
  it("splits known and unknown scopes", () => {
    expect(parseScopeParam("posts:read offline_access")).toEqual({
      known: ["posts:read"],
      unknown: ["offline_access"],
    });
    expect(parseScopeParam(undefined)).toBeNull();
    expect(parseScopeParam("  ")).toBeNull();
  });
});
