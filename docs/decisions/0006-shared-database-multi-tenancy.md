# 0006. Shared database multi-tenancy with `community_id` and RLS

Store all communities in one PostgreSQL schema, scope every tenant table by `community_id`, enforce it in a repository layer, and add row level security as defense in depth.

Status: Draft, 2026-10-17

- ADR status: Proposed
- Date: 2026-10-17
- Deciders: architecture docs wave
- Related: [../architecture/multi-tenancy.md](../architecture/multi-tenancy.md)

## Context

The brief asks for tenant isolation and authorization rules. REQ-NFR-SEC-001 requires isolation in one data access layer with cross-tenant tests in CI. The tenant is the community. Users are shared across communities on an instance (REQ-ID-004). Communities are many and mostly small. cohory has no per-tenant schema customization.

## Decision

- One database, one schema. `community_id uuid not null` on every tenant-scoped table, including child tables.
- A scoped repository helper is the only normal data access path. It requires a tenant context and adds the filter to every query. Unscoped access uses a separate handle restricted by lint to an allowlist of files.
- PostgreSQL RLS policies on tenant tables using a per-transaction setting, enabled on Cloud from Phase 4 and on by default on Community Edition (switchable).
- Generated cross-tenant tests for every API route, plus repository, RLS, job, page, and export tests. Merge-blocking.
- Cross-tenant requests return 404.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Schema per tenant | Stronger default isolation, per-tenant restore | Migrations per schema, slow deploys with many communities, cross-community features harder, pooling complexity | No customization need justifies it. |
| Database per tenant | Strongest isolation | Operationally heavy, especially for self-hosters | Disproportionate. |
| `community_id` without RLS | Simplest | One forgotten filter leaks data | RLS is cheap insurance for a trust-critical product. |
| RLS only, no repository layer | One mechanism | Errors are silent empty results, harder to debug and test, depends on every connection setting the variable | Repository layer gives clear errors and types. |

## Consequences

- Positive: one migration run, simple cross-community features, two independent enforcement layers.
- Negative: every query must run in a transaction that sets the tenant variable when RLS is on. Jobs must set it too.
- Negative: per-tenant restore requires the export bundle rather than a schema dump.
- Follow-up: `scoped()` helper, `TenantTable` type, lint rule for `platformDb`, RLS migration, test generators.

## Open questions

- RLS required or optional on Community Edition (proposed: on by default).
