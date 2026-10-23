# 0019. MCP tools dispatch through the REST handlers

Each MCP tool is generated from one `/api/v1` operation and runs by sending that operation's HTTP request, with the caller's token, through the same in process Hono app.

- ADR status: Accepted (founder, 2026-10-19, as built)
- Date: 2026-10-19
- Deciders: Step 14 unit S1 (proposed)
- Related: [0011](0011-mcp-first-class-api-surface.md), [0017](0017-bearer-api-tokens.md), [0018](0018-approvals-replay-recorded-requests.md), [../architecture/agent-integrations.md](../architecture/agent-integrations.md) section 4, [../operations/mcp.md](../operations/mcp.md)

## Context

The roadmap's Phase 6 acceptance asks that every MCP tool maps to a REST operation with the same authorization. Step 13 put authorization for tokens in the bearer middleware of `/api/v1` (scope, approval classification, community binding, rate limits, the approval gateway, and the audit source), and in the services the routes call (role rules). An MCP server that called services directly would need its own copy of all of that, and the two copies would drift.

## Decision

- Route metadata (`packages/api/src/route-meta.ts`, table in `src/mcp-tools.ts`) names the tools of an operation: name, title, description, annotations, whether results contain member written content, and optional inputs to omit or require. One operation can back several tools (`create_draft_post` and `schedule_post` both use `createPost`).
- Protocol revisions (Step 14 S3): `/mcp` serves `2026-07-28` requests itself and the handshake revisions through the SDK, because no official SDK speaks `2026-07-28` yet. See [../operations/mcp.md](../operations/mcp.md#protocol-revisions).
- `@cohory/mcp` builds tool input and output JSON Schemas from the generated OpenAPI 3.1 document (path and query parameters plus the flattened JSON body; `slug` and `communityId` come from the token), with referenced components under `$defs`.
- A tool call builds the REST request (method, path, query, JSON body, and only the caller's `Authorization` header) and passes it to `api.fetch(request, mcpBindings)`. The whole middleware chain runs: authentication, rate limits, scope and approval decision, community check, the route's Zod validation, the handler and its service policy checks, the approval gateway, and the audit source. `mcpBindings` is an in process Hono binding keyed by a module private symbol; the bearer middleware reads it to record `via = mcp`. A client cannot set it over the network. Since Step 14 S3 the binding is created per call by `mcpBindingsFor({ raw, authenticated })`.
- `tools/list` filters with the same `tokenDecision` function the middleware uses, plus `roleMayPerform` for the owner's role.
- The transport is the official SDK's web standard Streamable HTTP transport in stateless JSON mode, with a new server instance per HTTP request. No sessions are kept, so any web replica can serve any request and nothing needs to be stored.

## Consequences

- Authorization is identical by construction, and a test fails when a tool lacks an operation or differs in scope or action from it.
- Each tool call authenticates the token once: `/mcp` passes its result to the middleware through `mcpBindingsFor`, which the middleware uses only when the header carries the same token (changed in Step 14 S3; the first version authenticated twice).
- Tools follow the REST input shape. A breaking route change is a breaking tool change, which the `/api/v1` additive rule already prevents.
- No server to client requests (sampling, elicitation) and no event stream are possible without sessions. None are needed for the current tools.
