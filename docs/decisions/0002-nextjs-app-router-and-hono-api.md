# 0002. Next.js App Router with a Hono API

Render the UI with Next.js App Router server components and serve the HTTP API with Hono and Zod inside the same Next.js app, both calling the same domain services.

Status: Draft, 2026-10-17

- ADR status: Proposed
- Date: 2026-10-17
- Deciders: founder (Next.js is Confirmed as initial preference), architecture docs wave (Hono)
- Related: [../architecture/overview.md](../architecture/overview.md) section 6, [../architecture/agent-integrations.md](../architecture/agent-integrations.md) sections 2 and 3

## Context

**Confirmed:** TypeScript and Next.js as initial preferences, backend in Next.js initially. **Confirmed:** API-first, OpenAPI at `/api/openapi.json`, MCP as a first-class feature. Requirements: first feed page renders on the server (REQ-POST-002), initial JS under 200 KB (REQ-NFR-PERF-003), REST API documented with OpenAPI 3.1 (REQ-AGT-001).

We need one place where validation and API contracts are defined so that the web client, the public API, the SDK, and MCP cannot drift.

## Decision

- Next.js App Router for all pages. Server components call module services directly for reads.
- A Hono app built with `@hono/zod-openapi` is mounted at `/api/v1` through a catch-all route handler. It serves client mutations from the web app (session auth) from Phase 1 and external tokens from Phase 6.
- Zod schemas are exported by modules and reused by Hono routes. OpenAPI is generated from route definitions and committed as a snapshot checked in CI.
- Server Actions are allowed only for forms that must work without JavaScript, and must call the same services.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Next.js route handlers with hand-written OpenAPI | No extra library | OpenAPI drifts from code, validation duplicated | Drift is the problem we want to remove. |
| tRPC | Excellent type safety for the web client | Not REST, OpenAPI only through adapters, awkward for agents and third parties | The public API must be plain REST with OpenAPI. |
| Server Actions for all mutations | Least code for the web client | Not callable by agents, no OpenAPI, second write path | Contradicts API-first. |
| Separate API service (NestJS, Fastify) | Clear separation | Second process and deployment, duplicate auth | Contradicts ADR 0001 for no gain. |

## Consequences

- Positive: one contract for web, API, SDK, and MCP. The web app dogfoods the API.
- Negative: client mutations make an HTTP round trip instead of a Server Action call. Acceptable cost.
- Negative: two routing systems in one app (Next.js pages, Hono API). Kept apart by path prefix.
- Follow-up: error mapping, idempotency key middleware, OpenAPI snapshot test.

## Open questions

- Whether Hono's Next.js adapter works with every runtime feature we need (streaming, raw body for webhooks). Webhook routes may stay as plain Next.js route handlers. **Assumption** that it works, to verify in Phase 1.
