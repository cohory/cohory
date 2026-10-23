---
name: typescript-best-practices
description: Use when writing, editing, or reviewing any .ts or .tsx file in Cohory, including Drizzle schemas, zod validators, server actions, route handlers, and React components.
---

# TypeScript best practices

Apply the type system discipline and boundary discipline entries in `engineering-principles` first. This skill grounds them in syntax for Cohory's stack (TypeScript strict mode, Next.js App Router, Drizzle, zod, Better Auth, Stripe). Code examples live in `references/patterns.md`.

If `AGENTS.md` or `docs/architecture/*.md` define a rule that differs from this table, the project doc wins.

## Rules

| Rule | Summary |
|------|---------|
| Discriminated unions | Model variants with a `kind` literal. No optional-field bags such as `{ loading: boolean; data?: T; error?: string }`. |
| Branded ids | `type CommunityId = string & { readonly __brand: "CommunityId" }`. A brand comes from a parse function or a verifying type guard, never from `as`. |
| Constructive modeling | Build the shape so the illegal value cannot exist: `[T, ...T[]]` for non-empty, `start` plus `durationMs` for a range. |
| Simplest total type | Keep `T[]` while every operation stays total. Strengthen only where the loose type forces `!`, a cast, or a "should never happen" throw. |
| `unknown` over `any` | External data is `unknown`: request bodies, `JSON.parse`, webhook payloads, `process.env`, `searchParams`, raw SQL rows. |
| Schemas before guards | Use zod and infer the type with `z.infer`. Do not hand-write a property-by-property guard. Do not add a second schema library. |
| Derive from Drizzle | Use `typeof table.$inferSelect` and `$inferInsert` (or `drizzle-zod`) instead of a hand-written row interface. |
| No `as` casts | Cast only after validation. `as const` and `satisfies` are fine. |
| Narrowing order | Discriminant switch, then `in`, then `typeof` or `instanceof`, then a type guard, then `as` as a last resort. |
| Honest type guards | A guard named `isX` must verify the claim. A lying guard is worse than `as`. |
| Exhaustiveness | `const _exhaustive: never = value;` in every `default` arm over a union. |
| `satisfies` over `as` | Validates config objects without widening literals. |
| Boundary validation | Parse once in the route handler, server action, or webhook into a named domain type. Trust it inside `packages/*`. |
| Object args | Functions with two or more same-typed parameters take one object argument. |
| Real tests | Do not mock what you can run. Test against a real Postgres (Docker Compose or a test container). Mock only third-party network boundaries such as Stripe and S3. |
| Structured logging | No `console.log` in shipped code. Use the project logger with an id that lets someone debug from the log line. |

## Next.js specifics

- Server components are the default. Add `"use client"` only at the leaf that needs state, effects, or browser APIs.
- Server actions and route handlers are boundaries. Every one parses its input with zod and checks the session and membership role before touching data.
- Never import server-only modules (Drizzle client, Stripe secret key, Better Auth server) into a client component. Mark such modules with `import "server-only"`.
- Read env vars through one parsed env module, never `process.env.X` scattered across files.

## Drizzle specifics

- The Drizzle schema in each module (re-exported by `packages/db`) is the source of truth for row shapes. Derive, do not duplicate.
- Multi-step writes that must succeed together go in `db.transaction`.
- Scope every query that reads tenant data by community id. A query without the scope is a data leak waiting for a caller.

## Before you finish

Run the repo's typecheck and lint scripts (for example `pnpm typecheck` and `pnpm lint`, or `pnpm turbo run typecheck lint`). New `any`, `@ts-ignore`, `@ts-expect-error`, or `eslint-disable` lines need a one-line reason on the same line, or they do not ship.
