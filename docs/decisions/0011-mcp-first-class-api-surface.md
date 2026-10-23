# 0011. MCP as a first-class API surface

Expose Cohory to AI assistants through an MCP server at `/mcp` that is generated from the same route definitions as the REST API and enforces the same permissions.

- ADR status: Accepted (MCP as a first-class feature is Confirmed). Transport, auth, and tool details are Proposed.
- Date: 2026-10-17
- Deciders: founder (MCP first class, scoped permissions, approvals), architecture docs wave (design)
- Related: [../architecture/agent-integrations.md](../architecture/agent-integrations.md), [../architecture/authorization.md](../architecture/authorization.md)

## Context

**Confirmed:** MCP should be a first-class feature, every UI action should be available to agents, agents have scoped permissions, audit logs, and human approval, and agents never get unrestricted financial or admin permissions. MCP is post-MVP (Phase 6, REQ-AGT-005).

Research: comparable projects (Formbricks, Cal.com, Payload, Twenty) run MCP next to their API, reuse its auth and services, default to read-only access, and use OAuth 2.1 for hosted servers.

## Decision

- MCP server in process at `/mcp`, Streamable HTTP transport.
- Tools are generated from Hono route definitions marked with MCP metadata. No tool has its own business logic.
- OAuth 2.1 with PKCE and dynamic client registration. Agent API tokens as a fallback.
- Read-only scopes by default. Per-tool scope checks. Tool annotations for read-only and destructive operations.
- Sensitive actions return a pending approval result instead of executing.
- Every call logged, every write audited with the agent identity and its human owner.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Separate MCP service | Independent scaling | Duplicated auth and logic, extra deployment | Contradicts ADR 0001. |
| Local stdio MCP client package only (Discourse style) | Easy for developers | Requires users to run software, API keys copied around | Hosted OAuth flow is friendlier and safer. Can be added later. |
| Hand-written MCP tools | Tailored tool descriptions | Drift from the API, double maintenance | Generated tools stay in sync. Descriptions can still be curated in metadata. |
| No MCP, REST only | Less work | Ignores a Confirmed founder requirement | Not an option. |

## Consequences

- Positive: agents get the same capabilities and the same limits as API users, with no second permission system.
- Negative: generated tools can be too fine grained for assistants. Curated composite tools (for example `find_inactive_members`) may be needed, implemented as API routes first.
- Negative: OAuth 2.1 server responsibilities (client registration, consent, token lifetimes).
- Follow-up: route metadata format, consent screen, approval queue, MCP conformance tests against the current spec.

## Open questions

- Current MCP authorization spec requirements at implementation time (**Assumption** that OAuth 2.1 with protected resource metadata is still required).
- Which composite tools are worth adding beyond generated ones.
