---
name: how
description: Use when asked "how does X work", before changing an unfamiliar subsystem, or for placement and ownership questions such as "where should this live", "which package owns this", or "is this the right layer". Produces an architectural walkthrough, not annotated source.
---

# How

Answer "how does X work?" at the level of a senior engineer onboarding onto a subsystem. The goal is a working mental model, not a line-by-line tour. For "why is it built this way", use the `why` skill.

## 1. Read the map first

Read `AGENTS.md` and any `docs/architecture/*.md` file that covers the area. Check the monorepo layout (`apps/web`, `packages/*`) and the relevant `package.json` exports to see the public API of each package.

## 2. Size the question

If the scope is ambiguous, state your interpretation and proceed. The human can redirect.

- **Simple** (one module, one function, one route): explore and explain directly with Read, Grep, and Glob.
- **Complex** (a flow that crosses packages, such as "how does a paid member get access to a course"): split it into two to four angles (for example data model, request path, background jobs, auth checks). Spawn one `Agent` subagent of the Explore type per angle in a single message. Each returns file pointers with line numbers, the key types, and the call flow for its angle. Do not paste their raw output into your answer.

When in doubt, take the simple path.

## 3. Explain

Use these sections and drop any that do not apply.

- **Overview.** Two or three sentences on what the subsystem does and for whom.
- **Key concepts.** The core types and tables, with `file:line` pointers.
- **How it works.** The runtime flow from entry point (page, server action, route handler, webhook, job) to the database and back. A short mermaid sequence or flow diagram helps when three or more parts interact.
- **Where things live.** Which package owns which responsibility, and where a new piece of this kind should go.
- **Gotchas.** Non-obvious invariants, tenant scoping, caching, auth checks, idempotency keys, anything that would surprise the next person.

Cite real paths. Never invent a function or file. A search that finds nothing is an answer, so say so.

## Placement questions

For "where should this live", answer with the owning package and the reason (the knowledge it owns, not the order it runs in). If no package fits, say so and propose one, checking it against the red flags in `architect/references/design-red-flags.md`.
