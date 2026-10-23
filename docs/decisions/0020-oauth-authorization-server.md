# 0020. Built in OAuth authorization server for MCP clients

Cohory runs its own small OAuth 2.1 authorization server whose access tokens are ordinary agent API tokens, so MCP clients and REST clients are authorized by the same bearer middleware.

Status: Accepted, 2026-10-19

- ADR status: Accepted (founder, 2026-10-19, as built)
- Date: 2026-10-19
- Deciders: Step 14 unit S2 (proposed)
- Related: [0011](0011-mcp-first-class-api-surface.md), [0017](0017-bearer-api-tokens.md), [0004](0004-better-auth.md), [../architecture/agent-integrations.md](../architecture/agent-integrations.md) section 4, [../architecture/authorization.md](../architecture/authorization.md) sections 6 and 7

## Context

The MCP authorization specification (revision 2026-07-28) asks an MCP server to publish OAuth 2.0 Protected Resource Metadata (RFC 9728) and an authorization server that supports OAuth 2.1 with PKCE, Authorization Server Metadata (RFC 8414), resource indicators (RFC 8707), and a way for unknown clients to register. Desktop assistants connect without any prior relationship with a self hosted Cohory, so registration has to be automatic. Step 13 already built agent identities, scoped `api_tokens`, and a bearer middleware that checks scope, the owner's current role, community, rate limits, approvals, and audit on every request ([ADR 0017](0017-bearer-api-tokens.md)).

Better Auth 1.7.10 (pinned) ships an OIDC provider and an MCP plugin. Both issue their own access tokens into their own tables, bind them to a user rather than to a community and an agent, and keep a second consent and permission model. Using them would mean two token formats and two authorization paths for the same API.

## Decision

- Implement a minimal authorization server in `@cohory/agents/oauth` with HTTP endpoints in `@cohory/api` (`createOAuthApp`): `/.well-known/oauth-protected-resource` (and `/mcp` path inserted), `/.well-known/oauth-authorization-server`, `/oauth/register` (RFC 7591), `/oauth/authorize` (a consent page in the web app), `/oauth/token`, and `/oauth/revoke` (RFC 7009). The issuer is the origin of `APP_URL`; the only resource is `<APP_URL>/mcp`.
- Public clients only (`token_endpoint_auth_method` `none`), authorization code with PKCE `S256` only, exact redirect URI match against the registered list, `https` redirects or `http` on `127.0.0.1`, `[::1]`, or `localhost`. Authorization responses carry `state` and `iss` (RFC 9207). A `resource` parameter must name `<APP_URL>/mcp`; when it is missing the grant is still bound to that resource.
- The consent screen creates or reuses an agent identity owned by the signed in person, in a community where that person may create agents (owner or admin). A grant (`oauth_grants`, migration 0022) links client, person, community, agent, and scopes. Codes live 60 seconds, are stored as SHA-256 hashes, and are single use; a replayed code ends the grant.
- Access tokens are `api_tokens` rows of kind agent with `oauth_grant_id` set, expiring after 1 hour, in the existing `cohory_` format. The bearer middleware accepts them only from the MCP dispatch. For these tokens the effective scopes are the agent's current scopes intersected with the grant's.
- Refresh tokens (`cohoryrt_` prefix, hashed, 30 days) rotate on every use. The grant is the token family: presenting a rotated refresh token ends the grant, revokes its refresh tokens, and revokes every access token issued under it.
- People see their connections in Account, Connected apps, and owners and admins see the community's in Manage, Settings, Agents. Disconnect ends the grant and revokes its tokens at once. Grant creation, token issue, refresh, revocation, reuse detection, and disconnect are audit entries with the person, the agent, and the client.

## Consequences

- One authorization path for REST and MCP: scopes, approvals, rate limits, the Agent badge, and the audit log apply to OAuth clients exactly as to agent tokens.
- Dynamic client registration is open and unauthenticated, rate limited per address. Client names are not verified, so the consent screen always shows a warning and the redirect host.
- Access tokens are opaque and checked against the database on every request, so revocation and disconnect take effect on the next request.
- Tokens are bound to the `/mcp` resource and work only there (Step 14 S3): the MCP specification requires a server to accept only tokens issued for it, and a token that reached `/api/v1` could call routes that no tool exposes. `/api/v1` answers 401 `invalid_token` with `details.reason` `wrong_resource`. Scripts that call the REST API use an agent token from the Agents page.

## Alternatives considered

- **Better Auth OIDC provider or MCP plugin.** Rejected: separate token tables and consent model, user scoped tokens, no agent identity or community binding.
- **A separate authorization server (Keycloak, Ory Hydra).** Rejected: a second service for self hosters and a token introspection hop on every request.
- **JWT access tokens.** Rejected for the same reason as in ADR 0017: revocation on the next request needs a lookup anyway.
- **Confidential clients with secrets.** Not built: MCP desktop and CLI clients are public clients, and PKCE protects the code exchange.

## Decisions and open questions

- **Recommendation:** accept for Phase 6.
- **Open question:** Client ID Metadata Documents (SHOULD in the 2026-07-28 revision, where dynamic registration is deprecated but still allowed) are not supported yet; adding them needs SSRF safe fetching through `@cohory/egress` and caching.
- **Open question:** custom URL scheme redirects for native apps are refused, following the MCP rule that redirect URIs are `localhost` or `https`.
- **Open question:** registered clients are never deleted; a cleanup job for clients without grants could follow.
