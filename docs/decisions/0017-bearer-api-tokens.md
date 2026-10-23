# 0017. Bearer API tokens and agent identities on /api/v1

Personal and agent API tokens authenticate requests to `/api/v1` next to the Better Auth session cookie, and every route declares the scope a token needs.

Status: Accepted, 2026-10-19

- ADR status: Accepted (founder, 2026-10-19, as built)
- Date: 2026-10-19
- Deciders: Step 13 unit R1 (proposed)
- Related: [0002](0002-nextjs-app-router-and-hono-api.md), [0004](0004-better-auth.md), [0011](0011-mcp-first-class-api-surface.md), [../architecture/authorization.md](../architecture/authorization.md) sections 6 to 8, [../architecture/agent-integrations.md](../architecture/agent-integrations.md)

## Context

Until Step 13 the only way to call `/api/v1` was a signed in browser session. Phase 6 needs scripts, automations, and AI assistants to call the same API with explicit, revocable, auditable permissions (REQ-AGT-002, REQ-AGT-004), and the MCP server in Step 14 will reuse whatever this step builds. Better Auth has an API key plugin, but its keys belong to a user, not to a community, carry no notion of an agent identity, and keep their own permission model next to ours.

## Decision

- Tokens are our own rows (`api_tokens`, migration 0019), owned by the agents module (`@cohory/agents`). The format is `cohory_` plus 32 random bytes in base64url. Only the SHA-256 hash and a 12 character display prefix are stored; the secret is shown once. Lookup is by hash under a row level security policy keyed on `app.api_token_hash`, and the stored and computed hashes are compared in constant time.
- Every token is bound to one community. A personal token belongs to a person; an agent token belongs to an agent identity (`agent_identities`) owned by one person. Tokens expire (90 days by default, at most 365) and can be revoked; agents can be paused or revoked, which stops all their tokens.
- A Hono middleware in `packages/api/src/middleware/bearer.ts` runs before every `/api/v1` route. With `Authorization: Bearer cohory_...` it authenticates the token on every request (no cache), checks the matched route's `x-cohory` metadata, applies the token and agent rate limits, and sets the actor to the owning person with a `credential` (`type`, `tokenId`, `agentId`, `communityId`, `scopes`, `via`). Without the header, the session cookie path is unchanged.
- Effective permission is the route scope AND the owner's current role through the existing `can()`. The services do not know about scopes; they see the owner as the actor, so a demotion or departure applies on the next request.
- Agents never perform the actions classified in `packages/authz/src/credentials.ts` (money, payment connections, roles, removals, deletions, exports and imports, ownership, custom domains, publishing). They get 403 `approval_required` until the approval queue exists. Tokens never manage tokens or agents.
- Requests through a token run inside an audit source (`runWithAuditSource` in `@cohory/db`), so every audit row written during the request records actor type, via, token id, and agent id. A write with no audit row of its own gets one `api.<operation>` entry.

## Consequences

- One more authentication path to keep secure. Tokens never reach logs, and failures answer 401 with a plain reason.
- Every new route must declare `x-cohory` (a test fails otherwise), which is also what Step 14 uses to generate MCP tools.
- Rate limit counters stay in process memory like the other limits, so several web containers each count on their own.

## Alternatives considered

- **Better Auth API key plugin.** Rejected: user scoped keys with a second permission model, no agent identity, no community binding.
- **Scope checks inside each service.** Rejected: services call many policy actions incidentally, and the scope belongs to the delivery surface; the role check already lives in services.
- **Short lived signed tokens (JWT).** Rejected for now: revocation on the next request needs a lookup anyway. OAuth 2.1 for MCP clients comes with Step 14.

## Decisions and open questions

- **Recommendation:** accept for Phase 6.
- **Open question:** separate limits for tokens of communities with recent revenue (business-model.md) are not built; one configurable limit applies.
