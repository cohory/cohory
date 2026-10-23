# 0001. Modular monolith

Build Cohory as one deployable application with strict internal module boundaries, not as microservices.

- ADR status: Accepted
- Date: 2026-10-17
- Deciders: founder (brief), architecture docs wave
- Related: [../architecture/overview.md](../architecture/overview.md) sections 2 to 5

## Context

**Confirmed** in the founder brief: a pragmatic modular monolith, with no microservices without justification. Modules are Identity, Communities, Members, Posts, Comments, Courses, Lessons, Events, Gamification, Payments, Subscriptions, Entitlements, Notifications, Migration, and Agent integrations.

Forces:

- Self-hosting must work on a 2 vCPU, 4 GB VPS and install in under 30 minutes (REQ-NFR-HOST-003).
- Paid checkout touches five modules in one flow. Consistency matters more than independent scaling.
- The team is small and the domain is still changing.
- Expected load per community is modest.

## Decision

- One codebase, one Docker image, two process roles (web and worker) plus a one-shot migrate container.
- Each module is a workspace package under `packages/modules/` with one public entry point, its own tables, and its own domain events.
- Modules communicate through exported service interfaces and domain events. No cross-module table joins outside declared read models. The dependency graph is acyclic and checked in CI.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Microservices per module | Independent deploys and scaling | Distributed transactions, many containers for self-hosters, network failure handling, tracing as a requirement | Costs far exceed benefits at Cohory's scale. Contradicts the brief. |
| Unstructured monolith (one app folder) | Fastest start | Boundaries erode, hard to extract later, hard for contributors and agents to work in one area safely | Module boundaries are needed for testing, review, and agent-friendly code. |
| Monolith with modules as folders in one package | Less package overhead | Boundaries enforced only by lint | Explicit package dependencies make direction visible and enforceable. Acceptable fallback if package overhead hurts. |

## Consequences

- Positive: simple deployment, one database transaction for cross-module flows, cheap refactors, a clear map for contributors.
- Negative: one bad module can affect the whole process (memory, CPU). Mitigated by background jobs and limits.
- Negative: 15 module packages add some configuration overhead.
- Follow-up: dependency-cruiser (or equivalent) rules in CI, a module template, the outbox for domain events.

## Open questions

- Whether Lessons stays a separate package or merges into Courses.
- Criteria for extracting a module later (proposed: only for a clearly different scaling or isolation need, recorded as a new ADR).
