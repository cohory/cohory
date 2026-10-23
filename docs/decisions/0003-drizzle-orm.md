# 0003. Drizzle ORM over Prisma

Use Drizzle ORM with schema files per module and committed SQL migrations.

Status: Draft, 2026-10-17

- ADR status: Accepted
- Date: 2026-10-17
- Deciders: founder (Drizzle preferred in the brief, notes say "Drizzle or Prisma"), architecture docs wave
- Related: [../architecture/data-model.md](../architecture/data-model.md)

## Context

**Confirmed:** PostgreSQL only. The brief lists Drizzle as the preferred ORM; the founder's notes allow Drizzle or Prisma. Needs: tenant-scoped query helpers, PostgreSQL features (partial indexes, generated `tsvector` columns, RLS, advisory locks), reviewable SQL migrations, and a small runtime for self-hosting.

Research ([../research/comparable-projects.md](../research/comparable-projects.md)): Prisma is the majority choice in comparable projects, and several of them add Kysely for raw SQL. Midday and Payload use Drizzle.

## Decision

- Drizzle ORM for schema definitions, queries, and migration generation.
- Each module owns `src/schema.ts`. `packages/db` re-exports all schemas for drizzle-kit.
- Migrations are generated SQL files, reviewed and committed, forward only.
- A scoped query helper wraps Drizzle for tenant enforcement.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Prisma | Most popular, mature tooling, good docs | Separate schema language, heavier client and engine, raw SQL escape hatch often needed, harder to express partial indexes and RLS policies | Drizzle covers SQL-level needs directly in TypeScript. |
| Kysely only | Excellent typed SQL builder | No schema definition or migration generation | Would need a second tool for migrations. |
| Raw SQL with a thin client | Full control | No types from schema, more boilerplate | Slower for contributors. |

## Consequences

- Positive: schema in TypeScript next to module code, SQL-close queries, small runtime, easy scoped helpers.
- Negative: smaller ecosystem than Prisma. Some contributors will know Prisma better.
- Negative: drizzle-kit generated migrations need review for lock-heavy operations (see migration rules).
- Follow-up: column helpers (`id`, `tenant`, `timestamps`, `money`), migration review checklist.

## Open questions

- None blocking. Revisit if drizzle-kit migration generation proves unreliable for our patterns.
