---
name: engineering-principles
description: Use when choosing a data shape, sizing a diff, placing validation, designing a migration, deciding whether to ask the human, or justifying a design choice in a review or PR. Index of Cohory's engineering principles with when each applies.
---

# Engineering principles

These are the rules that shape every non-trivial decision in Cohory. Each entry says when it applies and what it demands. Full text with patterns and tests lives in `references/principles.md`. Read the full entry before you cite a principle in a PR, plan, or review.

When a principle changes a decision, name it in your reply or PR next to the choice it changed ("per boundary discipline, the Stripe webhook parses the payload once in the route handler").

## Core

- **Laziness protocol.** Sizing a diff or tempted to add a layer. Make the smallest change that solves the problem. Put each decision behind one source of truth.
- **Foundational thinking.** Before writing logic. Get the data shape right first. Scaffold (CI, lint, test setup, shared types) before features.
- **Redesign from first principles.** Adding a requirement to an existing design. Build what you would build if the requirement had been there on day one. Do not bolt it on.
- **Attack the premise.** Two fixes that share one assumption failed the same check. Write the assumption down and test it before a third fix.
- **Subtract before you add.** Sequencing a change. Delete dead code, redundant guards, and stubs first, then build on the smaller base.
- **Minimize reader load.** Code is hard to trace. Count layers between question and answer and the hidden state a reader must hold. Inline one-caller wrappers.
- **Outcome-oriented execution.** A planned migration with phase boundaries. Converge on the target. Do not write throwaway compatibility code to keep every step smooth.
- **Experience first.** Product or scope tradeoffs. Ship fewer, polished features. Loading, empty, and error states are part of the feature.
- **Exhaust the design space.** A novel interaction or architecture with no precedent in the repo. Build two or three competing options and compare them. See the `prototype` and `architect` skills.
- **Build the lever.** Any non-trivial edit, migration, or check. Write the codemod, script, or generator that does or proves the work, so a reviewer can rerun it.

## Architecture

- **Model the domain.** Stateful logic or branching that repeats a shape assumption. Use a discriminated union, state machine, lookup table, or typed model instead of scattered booleans.
- **Boundary discipline.** Wiring validation or error handling. Validate at the edges (route handlers, server actions, webhooks, env, Drizzle rows from raw SQL). Trust types inside. Keep business logic in pure functions in `packages/*`.
- **Type system discipline.** Designing a type or signature. Make illegal states unrepresentable, brand ids, parse external data, derive types from the Drizzle schema. See `typescript-best-practices`.
- **Make operations idempotent.** Webhooks, background jobs, seeds, migrations, retries. Ask what happens if it runs twice or crashes halfway. Converge to the same end state.
- **Migrate callers, then delete legacy APIs.** Replacing an internal API. Move every caller and delete the old one in the same change. No dual paths.
- **Separate before serializing shared state.** Two actors (agents, jobs, requests) may write the same file, branch, row, or key. Remove the sharing first. Lock only when one writer is a real invariant.

## Verification

- **Prove it works.** Before saying done. Check the real artifact (run the page, read the row, call the endpoint). "It compiles" and a subagent's report are not proof. See `superpowers:verification-before-completion`.
- **Fix root causes.** Debugging. Fix the first place the system went wrong, not where the symptom surfaced. A guard is a fix only if the state it handles is legitimate. See `superpowers:systematic-debugging`.
- **Sequence verifiable units.** Multi-step work and commit stacks. Each unit ends in a checked state before the next starts. Order commits so the history proves the change (failing test, then fix).
- **Test behavior, not implementation.** Writing or keeping a test. Assert what callers and users observe. A test must fail when behavior breaks and survive a refactor.
- **Explain the number.** Reporting a speedup, regression, or latency. Name the limiter and rule out errors, caching, and skipped work. See `benchmark-checklist`.

## Delegation

- **Guard the context window.** Large outputs, long files, wide searches. Send bulk reading to `Agent` subagents (Explore type for search) and keep only summaries in the main thread.
- **Never block on the human.** Tempted to ask "should I do X?" about reversible work. Do it, show the result, let the human correct it. Always pause for irreversible actions: force-push to shared branches, production deploys, data deletion, messages to real users, live Stripe operations.

## Meta

- **Encode lessons in structure.** You wrote the same instruction twice or got the same correction twice. Turn it into a lint rule, type, test, or script. Prose in AGENTS.md is the last resort. See `correct`.

## Precedence

Cohory's `AGENTS.md` and `docs/architecture/*.md` override these principles where they conflict. Read them first when they exist.
